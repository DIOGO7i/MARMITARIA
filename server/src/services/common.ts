import type { DB } from '../db';
import { getSettings } from '../db';
import { localNow, ValidationError } from '../money';

export class NotFoundError extends Error {
  status = 404;
}
export class ForbiddenError extends Error {
  status = 403;
}

export interface Ctx {
  db: DB;
  userId: number | null;
  role: 'owner' | 'staff';
  /** Módulos extras ligados (ver modules.ts). Sem isso (testes, scripts), tudo fica ligado. */
  modules?: import('../modules').Modules;
}

export const now = (db: DB) => localNow(getSettings(db).timezone);

export function nextNumber(db: DB, table: 'orders' | 'purchases'): number {
  const r = db.prepare(`SELECT COALESCE(MAX(number),0)+1 AS n FROM ${table}`).get() as { n: number };
  return r.n;
}

/** Data real do calendário (recusa 30/02, 31/04 etc.). */
export function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function reqDate(s: unknown, label = 'Data'): string {
  if (typeof s !== 'string' || !isRealDate(s)) throw new ValidationError(`${label} inválida.`);
  return s;
}
export function optDateTime(s: unknown, label: string): string | null {
  if (s == null || s === '') return null;
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(s) || !isRealDate(s.slice(0, 10))) throw new ValidationError(`${label} inválido.`);
  return s;
}

/** Data do recebimento/pagamento lançado junto com o pedido, compra ou despesa: quando a data é futura
 *  (encomenda para amanhã já paga), o dinheiro entrou HOJE — é no caixa de hoje que ele tem que aparecer. */
export function paidOn(db: Ctx['db'], date: string) {
  const t = now(db).date;
  return date > t ? t : date;
}

export function recordPayment(
  ctx: Ctx,
  p: { kind: 'recebimento' | 'pagamento'; refType: 'pedido' | 'compra' | 'despesa'; refId: number; amountCents: number; method?: string | null; paidDate: string; notes?: string | null },
) {
  ctx.db.prepare(`INSERT INTO payments(kind, ref_type, ref_id, amount_cents, method, paid_date, notes, user_id)
    VALUES (?,?,?,?,?,?,?,?)`).run(p.kind, p.refType, p.refId, p.amountCents, p.method ?? null, p.paidDate, p.notes ?? null, ctx.userId);
}

export function paidSum(db: DB, refType: string, refId: number): number {
  const r = db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE ref_type = ? AND ref_id = ?').get(refType, refId) as { s: number };
  return r.s;
}

/**
 * Estorna TUDO o que foi pago/recebido num lançamento, uma linha por forma de pagamento,
 * para o caixa do dia refletir a devolução na forma certa (dinheiro sai da gaveta, Pix não).
 * Devolve o total estornado.
 */
export function reverseAllPayments(ctx: Ctx, kind: 'recebimento' | 'pagamento', refType: 'pedido' | 'compra' | 'despesa', refId: number, paidDate: string, notes: string): number {
  const groups = ctx.db.prepare(`SELECT method, SUM(amount_cents) AS s FROM payments WHERE ref_type = ? AND ref_id = ? GROUP BY method HAVING SUM(amount_cents) != 0`)
    .all(refType, refId) as { method: string | null; s: number }[];
  let total = 0;
  for (const g of groups) {
    recordPayment(ctx, { kind, refType, refId, amountCents: -g.s, method: g.method, paidDate, notes });
    total += g.s;
  }
  return total;
}
