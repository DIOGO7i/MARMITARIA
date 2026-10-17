// Caixa do dia: troco inicial, sangrias/suprimentos, recebimentos por forma de pagamento e conferência no fechamento.
import { audit } from '../db';
import { ValidationError } from '../money';
import { Ctx, NotFoundError, reqDate } from './common';
import { formatBRL } from '../money';

/** "Dinheiro", " dinheiro ", "Dinheiro (espécie)", "Espécie": tudo é dinheiro da gaveta. */
export const isCash = (m: string | null) => {
  const t = (m ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return t.startsWith('dinheiro') || t === 'especie' || t.startsWith('especie ');
};
const UNKNOWN = 'Não informada';

function session(ctx: Ctx, day: string) {
  return ctx.db.prepare('SELECT * FROM cash_sessions WHERE day = ?').get(day) as any;
}

export function cashDay(ctx: Ctx, day: string) {
  reqDate(day, 'Data');
  const { db } = ctx;
  const s = session(ctx, day);
  // "count" conta só os lançamentos de verdade (estornos entram no valor, com sinal negativo, mas não somam na quantidade)
  const byMethod = db.prepare(`SELECT COALESCE(NULLIF(TRIM(method), ''), ?) AS method, kind, SUM(amount_cents) AS total, SUM(amount_cents > 0) AS n
    FROM payments WHERE paid_date = ? GROUP BY 1, kind ORDER BY 1`).all(UNKNOWN, day) as { method: string; kind: string; total: number; n: number }[];
  const row = (r: (typeof byMethod)[number]) => ({ method: r.method, totalCents: r.total, count: r.n, cash: isCash(r.method), unknown: r.method === UNKNOWN });
  const received = byMethod.filter((r) => r.kind === 'recebimento').map(row);
  const paidOut = byMethod.filter((r) => r.kind === 'pagamento').map(row);
  const movements = db.prepare(`SELECT m.id, m.kind, m.amount_cents AS amountCents, m.reason, m.created_at AS createdAt, u.name AS userName
    FROM cash_movements m LEFT JOIN users u ON u.id = m.user_id WHERE m.day = ? ORDER BY m.id`).all(day) as any[];
  const cashIn = received.filter((r) => isCash(r.method)).reduce((a, r) => a + r.totalCents, 0);
  const cashOut = paidOut.filter((r) => isCash(r.method)).reduce((a, r) => a + r.totalCents, 0);
  const supply = movements.filter((m) => m.kind === 'suprimento').reduce((a, m) => a + m.amountCents, 0);
  const bleed = movements.filter((m) => m.kind === 'sangria').reduce((a, m) => a + m.amountCents, 0);
  const opening = s?.opening_cents ?? 0;
  const expected = opening + cashIn - cashOut + supply - bleed;
  const closedExpected = s?.status === 'fechado' ? s.expected_cash_cents as number : null;
  const prev = db.prepare("SELECT left_in_drawer_cents FROM cash_sessions WHERE day < ? AND status = 'fechado' ORDER BY day DESC LIMIT 1").get(day) as any;
  return {
    day,
    status: s ? s.status : 'nao_aberto',
    openingCents: opening,
    suggestedOpeningCents: prev?.left_in_drawer_cents ?? 0,
    received, paidOut, movements,
    cashInCents: cashIn, cashOutCents: cashOut, supplyCents: supply, bleedCents: bleed,
    expectedCashCents: closedExpected ?? expected,
    // lançamentos em dinheiro com a data deste dia feitos DEPOIS de fechar (o fechamento não muda; a tela avisa para reabrir e conferir)
    changedAfterCloseCents: closedExpected === null ? 0 : expected - closedExpected,
    // recebido/pago sem forma informada: se foi em dinheiro, está fora da conta da gaveta
    unknownMethodCents: received.filter((r) => r.unknown).reduce((a, r) => a + r.totalCents, 0),
    unknownMethodPaidCents: paidOut.filter((r) => r.unknown).reduce((a, r) => a + r.totalCents, 0),
    countedCashCents: s?.counted_cash_cents ?? null,
    differenceCents: s?.status === 'fechado' ? s.counted_cash_cents - s.expected_cash_cents : null,
    leftInDrawerCents: s?.left_in_drawer_cents ?? null,
    checks: s?.checks ? JSON.parse(s.checks) as Record<string, number> : {},
    notes: s?.notes ?? null,
    closedAt: s?.closed_at ?? null,
    totalReceivedCents: received.reduce((a, r) => a + r.totalCents, 0),
  };
}

export function openCash(ctx: Ctx, day: string, openingCents: number) {
  reqDate(day, 'Data');
  if (!Number.isInteger(openingCents) || openingCents < 0) throw new ValidationError('Troco inicial inválido.');
  if (session(ctx, day)) throw new ValidationError('O caixa deste dia já foi aberto.');
  ctx.db.prepare('INSERT INTO cash_sessions(day, opening_cents, opened_by) VALUES (?,?,?)').run(day, openingCents, ctx.userId);
  audit(ctx.db, 'caixa', null, 'aberto', { dia: day, troco: openingCents }, ctx.userId);
  return cashDay(ctx, day);
}

export function addCashMovement(ctx: Ctx, day: string, kind: 'sangria' | 'suprimento', amountCents: number, reason: string) {
  const s = session(ctx, day);
  if (!s) throw new ValidationError('Abra o caixa do dia primeiro.');
  if (s.status === 'fechado') throw new ValidationError('O caixa deste dia já foi fechado.');
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new ValidationError('Valor inválido.');
  if (!reason?.trim()) throw new ValidationError('Informe o motivo.');
  if (kind === 'sangria') {
    const has = cashDay(ctx, day).expectedCashCents;
    if (amountCents > has) throw new ValidationError(`Pelas contas, a gaveta só deveria ter ${formatBRL(has)}. Confira o valor da sangria (ou registre antes o dinheiro que entrou).`);
  }
  ctx.db.prepare('INSERT INTO cash_movements(day, kind, amount_cents, reason, user_id) VALUES (?,?,?,?,?)').run(day, kind, amountCents, reason.trim(), ctx.userId);
  audit(ctx.db, 'caixa', null, kind, { dia: day, valor: amountCents, motivo: reason.trim() }, ctx.userId);
  return cashDay(ctx, day);
}

export function closeCash(ctx: Ctx, day: string, i: { countedCashCents: number; leftInDrawerCents: number; checks?: Record<string, number>; notes?: string | null }) {
  const { db } = ctx;
  return db.transaction(() => {
    const s = session(ctx, day);
    if (!s) throw new ValidationError('Abra o caixa do dia primeiro.');
    if (s.status === 'fechado') throw new ValidationError('O caixa deste dia já foi fechado.');
    if (!Number.isInteger(i.countedCashCents) || i.countedCashCents < 0) throw new ValidationError('Informe o dinheiro contado na gaveta.');
    if (!Number.isInteger(i.leftInDrawerCents) || i.leftInDrawerCents < 0 || i.leftInDrawerCents > i.countedCashCents) throw new ValidationError('O valor deixado na gaveta deve estar entre zero e o valor contado.');
    const d = cashDay(ctx, day);
    db.prepare(`UPDATE cash_sessions SET status='fechado', expected_cash_cents=?, counted_cash_cents=?, left_in_drawer_cents=?, checks=?, notes=?, closed_by=?, closed_at=? WHERE id=?`)
      .run(d.expectedCashCents, i.countedCashCents, i.leftInDrawerCents, JSON.stringify(i.checks ?? {}), i.notes?.trim() || null, ctx.userId, new Date().toISOString(), s.id);
    audit(db, 'caixa', s.id, 'fechado', { dia: day, esperado: d.expectedCashCents, contado: i.countedCashCents, diferenca: i.countedCashCents - d.expectedCashCents }, ctx.userId);
    return cashDay(ctx, day);
  })();
}

export function reopenCash(ctx: Ctx, day: string) {
  const s = session(ctx, day);
  if (!s) throw new NotFoundError('Caixa não encontrado.');
  if (s.status !== 'fechado') throw new ValidationError('Este caixa não está fechado.');
  ctx.db.prepare(`UPDATE cash_sessions SET status='aberto', expected_cash_cents=NULL, counted_cash_cents=NULL, left_in_drawer_cents=NULL, closed_at=NULL, closed_by=NULL WHERE id=?`).run(s.id);
  audit(ctx.db, 'caixa', s.id, 'reaberto', { dia: day, contadoAntes: s.counted_cash_cents }, ctx.userId);
  return cashDay(ctx, day);
}
