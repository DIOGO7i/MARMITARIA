import { audit } from '../db';
import { ValidationError } from '../money';
import { applyMovement, MovementReason } from '../stock';
import { Ctx, NotFoundError, now, optDateTime } from './common';

export interface ProductInput {
  name: string;
  category?: string | null;
  unit: string;
  qtyMilli?: number;          // só usado na criação (saldo inicial)
  minQtyMilli: number;
  unitCostCents: number;
  supplierId?: number | null;
  notes?: string | null;
  active: boolean;
}

const mapProduct = (p: any) => ({
  id: p.id, name: p.name, category: p.category, unit: p.unit, qtyMilli: p.qty_milli, minQtyMilli: p.min_qty_milli,
  unitCostCents: p.unit_cost_cents, supplierId: p.supplier_id, supplierName: p.supplier_name ?? null, notes: p.notes, active: !!p.active,
  stockStatus: p.qty_milli <= 0 ? 'sem_estoque' : p.qty_milli <= p.min_qty_milli ? 'baixo' : 'ok',
  valueCents: Math.round((p.qty_milli * p.unit_cost_cents) / 1000),
});

function checkProduct(i: ProductInput) {
  if (!i.name?.trim()) throw new ValidationError('Informe o nome do produto.');
  if (!i.unit?.trim()) throw new ValidationError('Informe a unidade de medida.');
  if (!Number.isInteger(i.minQtyMilli) || i.minQtyMilli < 0) throw new ValidationError('Estoque mínimo inválido.');
  if (!Number.isInteger(i.unitCostCents) || i.unitCostCents < 0) throw new ValidationError('Custo unitário inválido.');
}

export function listProducts(ctx: Ctx, f: { q?: string; status?: string; active?: string; category?: string }) {
  const where: string[] = []; const args: any[] = [];
  if (f.q) { where.push('p.name LIKE ?'); args.push(`%${f.q}%`); }
  if (f.category) { where.push('p.category = ?'); args.push(f.category); }
  if (f.active === '1' || f.active === '0') { where.push('p.active = ?'); args.push(Number(f.active)); }
  const rows = ctx.db.prepare(`SELECT p.*, s.name AS supplier_name FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name`).all(...args).map(mapProduct);
  return f.status ? rows.filter((r) => r.stockStatus === f.status) : rows;
}

export function createProduct(ctx: Ctx, i: ProductInput) {
  checkProduct(i);
  const { db } = ctx;
  return db.transaction(() => {
    if (db.prepare('SELECT 1 FROM products WHERE name = ?').get(i.name.trim())) throw new ValidationError('Já existe um produto com esse nome.');
    const res = db.prepare(`INSERT INTO products(name, category, unit, qty_milli, min_qty_milli, unit_cost_cents, supplier_id, notes, active)
      VALUES (?,?,?,0,?,?,?,?,?)`).run(i.name.trim(), i.category || null, i.unit.trim(), i.minQtyMilli, i.unitCostCents, i.supplierId || null, i.notes?.trim() || null, i.active ? 1 : 0);
    const id = Number(res.lastInsertRowid);
    if (i.qtyMilli && i.qtyMilli > 0) {
      applyMovement(db, { productId: id, deltaMilli: i.qtyMilli, type: 'entrada', reason: 'saldo_inicial', occurredAt: now(db).dateTime, unitCostCents: i.unitCostCents, notes: 'Saldo inicial no cadastro', userId: ctx.userId });
    }
    audit(db, 'produto', id, 'criado', { nome: i.name }, ctx.userId);
    return getProduct(ctx, id);
  })();
}

export function updateProduct(ctx: Ctx, id: number, i: ProductInput) {
  checkProduct(i);
  const { db } = ctx;
  // A quantidade NUNCA é editada aqui: só movimentações alteram o saldo (histórico preservado).
  const dup = db.prepare('SELECT id FROM products WHERE name = ? AND id != ?').get(i.name.trim(), id);
  if (dup) throw new ValidationError('Já existe outro produto com esse nome.');
  const r = db.prepare(`UPDATE products SET name=?, category=?, unit=?, min_qty_milli=?, unit_cost_cents=?, supplier_id=?, notes=?, active=? WHERE id=?`)
    .run(i.name.trim(), i.category || null, i.unit.trim(), i.minQtyMilli, i.unitCostCents, i.supplierId || null, i.notes?.trim() || null, i.active ? 1 : 0, id);
  if (!r.changes) throw new NotFoundError('Produto não encontrado.');
  audit(db, 'produto', id, 'editado', null, ctx.userId);
  return getProduct(ctx, id);
}

export function getProduct(ctx: Ctx, id: number) {
  const p = ctx.db.prepare('SELECT p.*, s.name AS supplier_name FROM products p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=?').get(id);
  if (!p) throw new NotFoundError('Produto não encontrado.');
  return mapProduct(p);
}

const mapMove = (m: any) => ({
  id: m.id, productId: m.product_id, productName: m.product_name, unit: m.unit, type: m.type, reason: m.reason,
  qtyMilli: m.qty_milli, inMilli: m.qty_milli > 0 ? m.qty_milli : 0, outMilli: m.qty_milli < 0 ? -m.qty_milli : 0,
  balanceBeforeMilli: m.balance_before_milli, balanceAfterMilli: m.balance_after_milli, unitCostCents: m.unit_cost_cents,
  occurredAt: m.occurred_at, purchaseId: m.purchase_id, purchaseNumber: m.purchase_number ?? null, notes: m.notes, userName: m.user_name ?? null,
});

export function listMovements(ctx: Ctx, f: { productId?: number; type?: string; reason?: string; from?: string; to?: string; limit?: number }) {
  const where: string[] = []; const args: any[] = [];
  if (f.productId) { where.push('m.product_id = ?'); args.push(f.productId); }
  if (f.type === 'entrada') where.push('m.qty_milli > 0');
  if (f.type === 'saida') where.push('m.qty_milli < 0');
  if (f.reason) { where.push('m.reason = ?'); args.push(f.reason); }
  if (f.from) { where.push('m.occurred_date >= ?'); args.push(f.from); }
  if (f.to) { where.push('m.occurred_date <= ?'); args.push(f.to); }
  return ctx.db.prepare(`SELECT m.*, p.name AS product_name, p.unit, u.name AS user_name, pu.number AS purchase_number
    FROM stock_movements m JOIN products p ON p.id = m.product_id
    LEFT JOIN users u ON u.id = m.user_id LEFT JOIN purchases pu ON pu.id = m.purchase_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.id DESC LIMIT ?`).all(...args, Math.min(f.limit ?? 200, 1000)).map(mapMove);
}

export const OUT_REASONS: MovementReason[] = ['consumo', 'perda', 'descarte', 'uso_interno', 'ajuste_inventario', 'outro'];

export function registerStockOut(ctx: Ctx, i: { productId: number; qtyMilli: number; occurredAt?: string | null; reason: MovementReason; notes?: string | null; idempotencyKey?: string }) {
  const { db } = ctx;
  if (!OUT_REASONS.includes(i.reason)) throw new ValidationError('Motivo da saída inválido.');
  if (!Number.isInteger(i.qtyMilli) || i.qtyMilli <= 0) throw new ValidationError('Quantidade da saída inválida.');
  if ((i.reason === 'outro') && !i.notes?.trim()) throw new ValidationError('Descreva o motivo na observação.');
  return db.transaction(() => {
    const at = optDateTime(i.occurredAt, 'Data e horário') ?? now(db).dateTime;
    const p = db.prepare('SELECT unit_cost_cents FROM products WHERE id = ?').get(i.productId) as any;
    if (!p) throw new NotFoundError('Produto não encontrado.');
    const m = applyMovement(db, { productId: i.productId, deltaMilli: -i.qtyMilli, type: 'saida', reason: i.reason, occurredAt: at, unitCostCents: p.unit_cost_cents, notes: i.notes, userId: ctx.userId });
    audit(db, 'estoque', m.id, 'saida', { produto: i.productId, qtd: i.qtyMilli, motivo: i.reason }, ctx.userId);
    return { movementId: m.id, balanceMilli: m.after };
  })();
}

/** Ajuste de inventário: informa a contagem física e o sistema calcula a diferença (pode ser positiva ou negativa). */
export function inventoryAdjust(ctx: Ctx, i: { productId: number; countedMilli: number; notes?: string | null }) {
  const { db } = ctx;
  if (!Number.isInteger(i.countedMilli) || i.countedMilli < 0) throw new ValidationError('Quantidade contada inválida.');
  return db.transaction(() => {
    const p = db.prepare('SELECT qty_milli, unit_cost_cents FROM products WHERE id = ?').get(i.productId) as any;
    if (!p) throw new NotFoundError('Produto não encontrado.');
    const delta = i.countedMilli - p.qty_milli;
    if (delta === 0) throw new ValidationError('A contagem é igual ao saldo atual: nada a ajustar.');
    const m = applyMovement(db, { productId: i.productId, deltaMilli: delta, type: delta > 0 ? 'entrada' : 'saida', reason: 'ajuste_inventario', occurredAt: now(db).dateTime, unitCostCents: p.unit_cost_cents, notes: i.notes || 'Ajuste de inventário', userId: ctx.userId });
    audit(db, 'estoque', m.id, 'ajuste', { produto: i.productId, delta }, ctx.userId);
    return { movementId: m.id, balanceMilli: m.after };
  })();
}

export function listSuppliers(ctx: Ctx) {
  return ctx.db.prepare('SELECT id, name, cnpj, phone, notes, active FROM suppliers ORDER BY name').all().map((s: any) => ({ ...s, active: !!s.active }));
}
export function saveSupplier(ctx: Ctx, id: number | null, i: { name: string; cnpj?: string | null; phone?: string | null; notes?: string | null; active?: boolean }) {
  if (!i.name?.trim()) throw new ValidationError('Informe o nome do fornecedor.');
  const { db } = ctx;
  const cnpj = i.cnpj ? String(i.cnpj).replace(/\D/g, '') || null : null;
  if (cnpj && cnpj.length !== 14 && cnpj.length !== 11) throw new ValidationError('CNPJ deve ter 14 dígitos (ou CPF com 11).');
  if (cnpj && db.prepare('SELECT 1 FROM suppliers WHERE cnpj = ? AND id != ?').get(cnpj, id ?? 0)) throw new ValidationError('Já existe um fornecedor com esse CNPJ.');
  const dup = db.prepare('SELECT id FROM suppliers WHERE name = ? AND id != ?').get(i.name.trim(), id ?? 0);
  if (dup) throw new ValidationError('Já existe um fornecedor com esse nome.');
  if (id) {
    const r = db.prepare('UPDATE suppliers SET name=?, cnpj=?, phone=?, notes=?, active=? WHERE id=?').run(i.name.trim(), cnpj, i.phone || null, i.notes || null, i.active === false ? 0 : 1, id);
    if (!r.changes) throw new NotFoundError('Fornecedor não encontrado.');
    return { id };
  }
  const r = db.prepare('INSERT INTO suppliers(name, cnpj, phone, notes, active) VALUES (?,?,?,?,1)').run(i.name.trim(), cnpj, i.phone || null, i.notes || null);
  return { id: Number(r.lastInsertRowid) };
}
