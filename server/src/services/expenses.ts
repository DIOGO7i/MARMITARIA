import { audit } from '../db';
import { ValidationError } from '../money';
import { Ctx, NotFoundError, now, paidOn, recordPayment, reqDate, reverseAllPayments } from './common';

export interface ExpenseInput {
  idempotencyKey?: string;
  description: string;
  category: string;
  expenseDate: string;
  amountCents: number;
  paymentMethod?: string | null;
  status: 'pendente' | 'pago';
  paidDate?: string | null;
  dueDate?: string | null;
  notes?: string | null;
}

const map = (e: any) => ({
  id: e.id, description: e.description, category: e.category, expenseDate: e.expense_date, amountCents: e.amount_cents,
  paidCents: e.paid_cents, paymentMethod: e.payment_method, status: e.status, dueDate: e.due_date, notes: e.notes,
  voided: !!e.voided, voidReason: e.void_reason,
});

function check(i: ExpenseInput) {
  if (!i.description?.trim()) throw new ValidationError('Informe a descrição da despesa.');
  if (!i.category?.trim()) throw new ValidationError('Informe a categoria da despesa.');
  reqDate(i.expenseDate, 'Data da despesa');
  if (!Number.isInteger(i.amountCents) || i.amountCents <= 0) throw new ValidationError('O valor da despesa deve ser maior que zero.');
  if (i.dueDate) reqDate(i.dueDate, 'Vencimento');
}

export function createExpense(ctx: Ctx, i: ExpenseInput) {
  check(i);
  const { db } = ctx;
  return db.transaction(() => {
    const paid = i.status === 'pago';
    const r = db.prepare(`INSERT INTO expenses(description, category, expense_date, amount_cents, paid_cents, payment_method, status, due_date, notes, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(i.description.trim(), i.category, i.expenseDate, i.amountCents, paid ? i.amountCents : 0, i.paymentMethod || null,
      paid ? 'pago' : 'pendente', i.dueDate || null, i.notes?.trim() || null, ctx.userId);
    const id = Number(r.lastInsertRowid);
    if (paid) recordPayment(ctx, { kind: 'pagamento', refType: 'despesa', refId: id, amountCents: i.amountCents, method: i.paymentMethod, paidDate: i.paidDate ? reqDate(i.paidDate, 'Data do pagamento') : paidOn(db, i.expenseDate) });
    audit(db, 'despesa', id, 'criada', { valor: i.amountCents }, ctx.userId);
    return getExpense(ctx, id);
  })();
}

export function getExpense(ctx: Ctx, id: number) {
  const e = ctx.db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
  if (!e) throw new NotFoundError('Despesa não encontrada.');
  return map(e);
}

export function listExpenses(ctx: Ctx, f: { from?: string; to?: string; category?: string; status?: string; q?: string; includeVoided?: boolean }) {
  const where: string[] = []; const args: any[] = [];
  if (!f.includeVoided) where.push('voided = 0');
  if (f.from) { where.push('expense_date >= ?'); args.push(f.from); }
  if (f.to) { where.push('expense_date <= ?'); args.push(f.to); }
  if (f.category) { where.push('category = ?'); args.push(f.category); }
  if (f.status) { where.push('status = ?'); args.push(f.status); }
  if (f.q) { where.push('description LIKE ?'); args.push(`%${f.q}%`); }
  return ctx.db.prepare(`SELECT * FROM expenses ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY expense_date DESC, id DESC LIMIT 1000`).all(...args).map(map);
}

export function updateExpense(ctx: Ctx, id: number, i: ExpenseInput) {
  check(i);
  const { db } = ctx;
  const cur = db.prepare('SELECT * FROM expenses WHERE id=?').get(id) as any;
  if (!cur) throw new NotFoundError('Despesa não encontrada.');
  if (cur.voided) throw new ValidationError('Despesa anulada não pode ser editada.');
  if (cur.status === 'pago' && i.amountCents !== cur.amount_cents) throw new ValidationError('Despesa já paga: o valor não pode ser alterado. Anule e lance novamente.');
  db.prepare('UPDATE expenses SET description=?, category=?, expense_date=?, amount_cents=?, payment_method=?, due_date=?, notes=? WHERE id=?')
    .run(i.description.trim(), i.category, i.expenseDate, i.amountCents, i.paymentMethod || null, i.dueDate || null, i.notes?.trim() || null, id);
  audit(db, 'despesa', id, 'editada', null, ctx.userId);
  return getExpense(ctx, id);
}

export function payExpense(ctx: Ctx, id: number, p: { method?: string | null; paidDate?: string }) {
  const { db } = ctx;
  return db.transaction(() => {
    const cur = db.prepare('SELECT * FROM expenses WHERE id=?').get(id) as any;
    if (!cur) throw new NotFoundError('Despesa não encontrada.');
    if (cur.voided) throw new ValidationError('Despesa anulada.');
    if (cur.status === 'pago') throw new ValidationError('Esta despesa já está paga.');
    recordPayment(ctx, { kind: 'pagamento', refType: 'despesa', refId: id, amountCents: cur.amount_cents, method: p.method || cur.payment_method, paidDate: p.paidDate ? reqDate(p.paidDate, 'Data do pagamento') : now(db).date });
    db.prepare(`UPDATE expenses SET status='pago', paid_cents=amount_cents, payment_method=COALESCE(?, payment_method) WHERE id=?`).run(p.method || null, id);
    audit(db, 'despesa', id, 'paga', null, ctx.userId);
    return getExpense(ctx, id);
  })();
}

/** Anulação auditável (não apaga a linha). Estorna o pagamento, se houver. */
export function voidExpense(ctx: Ctx, id: number, reason: string) {
  if (!reason?.trim()) throw new ValidationError('Informe o motivo.');
  const { db } = ctx;
  return db.transaction(() => {
    const cur = db.prepare('SELECT * FROM expenses WHERE id=?').get(id) as any;
    if (!cur) throw new NotFoundError('Despesa não encontrada.');
    if (cur.voided) throw new ValidationError('Despesa já anulada.');
    reverseAllPayments(ctx, 'pagamento', 'despesa', id, now(db).date, `Estorno por anulação: ${reason.trim()}`);
    db.prepare(`UPDATE expenses SET voided=1, void_reason=?, paid_cents=0 WHERE id=?`).run(reason.trim(), id);
    audit(db, 'despesa', id, 'anulada', { motivo: reason.trim() }, ctx.userId);
    return getExpense(ctx, id);
  })();
}
