import { audit, getSettings } from '../db';
import { calcPurchaseTotals, paymentStatus, ValidationError } from '../money';
import { applyMovement } from '../stock';
import { Ctx, NotFoundError, nextNumber, now, paidOn, paidSum, recordPayment, reqDate, reverseAllPayments } from './common';
import { parseAccessKey } from '../nfe';
import { saveMapping } from './notes';

export interface PurchaseInput {
  idempotencyKey: string;
  purchaseDate: string;
  supplierId?: number | null;
  invoiceNumber?: string | null;
  accessKey?: string | null;
  newSupplier?: { name: string; cnpj?: string | null } | null;
  items: {
    productId?: number | null; qtyMilli: number; unitCostCents?: number | null; totalCents?: number | null;
    // produto que ainda não existe: é cadastrado dentro da mesma transação da compra
    newProduct?: { name: string; unit: string; category?: string | null } | null;
    // origem do item na nota fiscal: grava o vínculo para as próximas notas desse fornecedor
    source?: { code?: string | null; description: string; unit?: string | null; factorMilli: number; remember?: boolean } | null;
  }[];
  discountCents: number;
  freightCents: number;
  paymentMethod?: string | null;
  paymentStatus: 'pendente' | 'parcial' | 'pago';
  paidCents?: number;
  dueDate?: string | null;
  notes?: string | null;
}

function mapPurchase(db: Ctx['db'], p: any) {
  const items = db.prepare(`SELECT i.id, i.product_id AS productId, pr.name AS productName, i.qty_milli AS qtyMilli, i.unit,
    i.unit_cost_cents AS unitCostCents, i.total_cents AS totalCents FROM purchase_items i JOIN products pr ON pr.id = i.product_id
    WHERE i.purchase_id = ? ORDER BY i.id`).all(p.id);
  const sup = p.supplier_id ? (db.prepare('SELECT name FROM suppliers WHERE id = ?').get(p.supplier_id) as any)?.name : null;
  return {
    id: p.id, number: p.number, purchaseDate: p.purchase_date, supplierId: p.supplier_id, supplierName: sup, invoiceNumber: p.invoice_number, accessKey: p.access_key ?? null,
    itemsTotalCents: p.items_total_cents, discountCents: p.discount_cents, freightCents: p.freight_cents, totalCents: p.total_cents,
    paidCents: p.paid_cents, openCents: p.status === 'cancelada' ? 0 : p.total_cents - p.paid_cents, paymentMethod: p.payment_method,
    paymentStatus: p.payment_status, dueDate: p.due_date, notes: p.notes, status: p.status, cancelReason: p.cancel_reason, items,
  };
}

/** Rateia frete e desconto proporcionalmente ao valor dos itens, para formar o custo efetivo de cada item. */
export function allocateExtras(itemTotals: number[], extraCents: number): number[] {
  const sum = itemTotals.reduce((a, b) => a + b, 0);
  if (sum === 0 || extraCents === 0) return itemTotals.map(() => 0);
  let used = 0;
  return itemTotals.map((t, idx) => {
    if (idx === itemTotals.length - 1) return extraCents - used;
    const share = Math.round((extraCents * t) / sum);
    used += share;
    return share;
  });
}

export function createPurchase(ctx: Ctx, input: PurchaseInput) {
  const { db } = ctx;
  if (!input.idempotencyKey) throw new ValidationError('Chave de idempotência ausente.');
  return db.transaction(() => {
    const ex = db.prepare('SELECT * FROM purchases WHERE idempotency_key = ?').get(input.idempotencyKey);
    if (ex) return { ...mapPurchase(db, ex), duplicate: true, createdProducts: [] as string[] };

    reqDate(input.purchaseDate, 'Data da compra');
    let accessKey: string | null = null;
    if (input.accessKey) {
      accessKey = parseAccessKey(input.accessKey).key;
      const dup = db.prepare("SELECT number FROM purchases WHERE access_key = ? AND status = 'confirmada'").get(accessKey) as any;
      if (dup) throw new ValidationError(`Esta nota fiscal já foi lançada na compra #${dup.number}.`);
    }
    let supplierId = input.supplierId || null;
    if (!supplierId && input.newSupplier?.name?.trim()) {
      const cnpj = input.newSupplier.cnpj ? String(input.newSupplier.cnpj).replace(/\D/g, '') || null : null;
      const ex = (cnpj && db.prepare('SELECT id FROM suppliers WHERE cnpj = ?').get(cnpj)) || db.prepare('SELECT id FROM suppliers WHERE name = ?').get(input.newSupplier.name.trim());
      if (ex) {
        supplierId = (ex as any).id;
        if (cnpj) db.prepare('UPDATE suppliers SET cnpj = COALESCE(cnpj, ?) WHERE id = ?').run(cnpj, supplierId);
      } else {
        supplierId = Number(db.prepare('INSERT INTO suppliers(name, cnpj, active) VALUES (?,?,1)').run(input.newSupplier.name.trim(), cnpj).lastInsertRowid);
        audit(db, 'fornecedor', supplierId, 'criado_pela_nota', { cnpj }, ctx.userId);
      }
    }
    // Cadastra os produtos novos da nota (ou reaproveita um com o mesmo nome) — tudo na mesma transação
    const settings = getSettings(db);
    const created: string[] = [];
    for (const it of input.items) {
      if (it.productId) continue;
      const np = it.newProduct;
      if (!np?.name?.trim() || !np.unit?.trim()) throw new ValidationError('Escolha o produto do estoque ou informe nome e unidade do produto novo.');
      const name = np.name.trim().slice(0, 120);
      const ex = db.prepare('SELECT id FROM products WHERE name = ?').get(name) as any;
      if (ex) { it.productId = ex.id; continue; }
      const r = db.prepare('INSERT INTO products(name, category, unit, qty_milli, min_qty_milli, unit_cost_cents, active) VALUES (?,?,?,0,?,0,1)')
        .run(name, np.category || null, np.unit.trim(), settings.defaultMinStockMilli);
      it.productId = Number(r.lastInsertRowid);
      created.push(name);
      audit(db, 'produto', it.productId, 'criado_pela_compra', { nome: name }, ctx.userId);
    }
    const ids = input.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) throw new ValidationError('O mesmo produto aparece mais de uma vez. Some as quantidades em uma única linha.');
    const totals = calcPurchaseTotals(input.items, input.discountCents, input.freightCents);
    const products = input.items.map((i) => {
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(i.productId as number) as any;
      if (!p) throw new ValidationError('Produto da compra não encontrado.');
      return p;
    });

    let paid = 0;
    if (input.paymentStatus === 'pago') paid = totals.totalCents;
    else if (input.paymentStatus === 'parcial') {
      paid = input.paidCents ?? 0;
      if (!Number.isInteger(paid) || paid <= 0 || paid >= totals.totalCents) throw new ValidationError('Para pagamento parcial, informe um valor maior que zero e menor que o total.');
    }
    const number = nextNumber(db, 'purchases');
    const res = db.prepare(`INSERT INTO purchases(number, purchase_date, supplier_id, invoice_number, items_total_cents, discount_cents, freight_cents,
      total_cents, paid_cents, payment_method, payment_status, due_date, notes, idempotency_key, created_by, access_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      number, input.purchaseDate, supplierId, input.invoiceNumber?.trim() || null, totals.itemsTotalCents, input.discountCents,
      input.freightCents, totals.totalCents, paid, input.paymentMethod || null, paymentStatus(totals.totalCents, paid),
      input.dueDate || null, input.notes?.trim() || null, input.idempotencyKey, ctx.userId, accessKey);
    const purchaseId = Number(res.lastInsertRowid);

    const extras = allocateExtras(totals.lines.map((l) => l.totalCents), input.freightCents - input.discountCents);
    const at = `${input.purchaseDate}T${now(db).time}`;
    totals.lines.forEach((l, idx) => {
      const p = products[idx];
      db.prepare('INSERT INTO purchase_items(purchase_id, product_id, qty_milli, unit, unit_cost_cents, total_cents, prev_unit_cost_cents) VALUES (?,?,?,?,?,?,?)')
        .run(purchaseId, p.id, l.qtyMilli, p.unit, l.unitCostCents, l.totalCents, p.unit_cost_cents);
      const effectiveUnit = Math.round(((l.totalCents + extras[idx]) * 1000) / l.qtyMilli);
      applyMovement(db, { productId: p.id, deltaMilli: l.qtyMilli, type: 'entrada', reason: 'compra', occurredAt: at, unitCostCents: effectiveUnit, purchaseId, notes: `Compra #${number}`, userId: ctx.userId });
      // custo médio ponderado (saldo anterior × custo atual + compra) / novo saldo
      const oldQty = Math.max(p.qty_milli, 0);
      const newQty = oldQty + l.qtyMilli;
      const avg = Math.round((oldQty * p.unit_cost_cents + l.qtyMilli * effectiveUnit) / newQty);
      db.prepare('UPDATE products SET unit_cost_cents = ? WHERE id = ?').run(avg, p.id);
    });
    // Lembra "item da nota -> produto do estoque" para as próximas notas desse fornecedor
    const supCnpj = supplierId ? (db.prepare('SELECT cnpj FROM suppliers WHERE id = ?').get(supplierId) as any)?.cnpj : null;
    if (supCnpj) {
      input.items.forEach((it, idx) => {
        const src = it.source;
        if (src && src.remember !== false && src.description?.trim() && Number.isInteger(src.factorMilli) && src.factorMilli > 0) {
          saveMapping(ctx, supCnpj, src.code ?? null, src.description, src.unit ?? null, products[idx].id, src.factorMilli);
        }
      });
    }
    if (paid > 0) {
      recordPayment(ctx, { kind: 'pagamento', refType: 'compra', refId: purchaseId, amountCents: paid, method: input.paymentMethod, paidDate: paidOn(db, input.purchaseDate), notes: 'Pagamento registrado na compra' });
    }
    audit(db, 'compra', purchaseId, 'confirmada', { number, total: totals.totalCents }, ctx.userId);
    return { ...mapPurchase(db, db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId)), duplicate: false, createdProducts: created };
  })();
}

export function getPurchase(ctx: Ctx, id: number) {
  const p = ctx.db.prepare('SELECT * FROM purchases WHERE id = ?').get(id);
  if (!p) throw new NotFoundError('Compra não encontrada.');
  const payments = ctx.db.prepare(`SELECT id, amount_cents AS amountCents, method, paid_date AS paidDate, notes FROM payments WHERE ref_type='compra' AND ref_id=? ORDER BY id`).all(id);
  return { ...mapPurchase(ctx.db, p), payments };
}

export function listPurchases(ctx: Ctx, f: { from?: string; to?: string; supplierId?: number; status?: string; paymentStatus?: string; q?: string }) {
  const where: string[] = []; const args: any[] = [];
  if (f.from) { where.push('purchase_date >= ?'); args.push(f.from); }
  if (f.to) { where.push('purchase_date <= ?'); args.push(f.to); }
  if (f.supplierId) { where.push('supplier_id = ?'); args.push(f.supplierId); }
  if (f.status) { where.push('status = ?'); args.push(f.status); }
  if (f.paymentStatus) { where.push('payment_status = ?'); args.push(f.paymentStatus); }
  if (f.q) { where.push('(CAST(number AS TEXT) = ? OR invoice_number LIKE ?)'); args.push(f.q.replace(/^#/, ''), `%${f.q}%`); }
  const rows = ctx.db.prepare(`SELECT * FROM purchases ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY purchase_date DESC, id DESC LIMIT 500`).all(...args);
  return rows.map((r) => mapPurchase(ctx.db, r));
}

/** Campos que não afetam estoque nem valores: fornecedor, nota fiscal, forma de pagamento, vencimento, observações. */
export function updatePurchaseInfo(ctx: Ctx, id: number, i: { supplierId?: number | null; invoiceNumber?: string | null; paymentMethod?: string | null; dueDate?: string | null; notes?: string | null }) {
  const r = ctx.db.prepare('UPDATE purchases SET supplier_id=?, invoice_number=?, payment_method=?, due_date=?, notes=? WHERE id=? AND status = \'confirmada\'')
    .run(i.supplierId || null, i.invoiceNumber?.trim() || null, i.paymentMethod || null, i.dueDate || null, i.notes?.trim() || null, id);
  if (!r.changes) throw new ValidationError('Compra não encontrada ou já cancelada.');
  audit(ctx.db, 'compra', id, 'editada', null, ctx.userId);
  return getPurchase(ctx, id);
}

export function addPurchasePayment(ctx: Ctx, id: number, p: { amountCents: number; method?: string | null; paidDate?: string }) {
  const { db } = ctx;
  return db.transaction(() => {
    const cur = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as any;
    if (!cur) throw new NotFoundError('Compra não encontrada.');
    if (cur.status === 'cancelada') throw new ValidationError('Compra cancelada não recebe pagamentos.');
    if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new ValidationError('Valor do pagamento inválido.');
    const paid = paidSum(db, 'compra', id);
    if (paid + p.amountCents > cur.total_cents) throw new ValidationError('O pagamento ultrapassa o total da compra.');
    recordPayment(ctx, { kind: 'pagamento', refType: 'compra', refId: id, amountCents: p.amountCents, method: p.method || cur.payment_method, paidDate: p.paidDate ? reqDate(p.paidDate, 'Data do pagamento') : now(db).date });
    const np = paid + p.amountCents;
    db.prepare('UPDATE purchases SET paid_cents=?, payment_status=? WHERE id=?').run(np, paymentStatus(cur.total_cents, np), id);
    audit(db, 'compra', id, 'pagamento', { valor: p.amountCents }, ctx.userId);
    return getPurchase(ctx, id);
  })();
}

/** Cancelamento auditável: estorna estoque (movimentações de estorno) e pagamentos já feitos. */
export function cancelPurchase(ctx: Ctx, id: number, reason: string) {
  const { db } = ctx;
  if (!reason?.trim()) throw new ValidationError('Informe o motivo do cancelamento.');
  return db.transaction(() => {
    const cur = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as any;
    if (!cur) throw new NotFoundError('Compra não encontrada.');
    if (cur.status === 'cancelada') throw new ValidationError('Esta compra já foi cancelada.');
    const moves = db.prepare(`SELECT * FROM stock_movements WHERE purchase_id = ? AND reverses_id IS NULL AND type = 'entrada'`).all(id) as any[];
    const at = now(db).dateTime;
    for (const m of moves) {
      const p = db.prepare('SELECT qty_milli, unit_cost_cents FROM products WHERE id = ?').get(m.product_id) as { qty_milli: number; unit_cost_cents: number };
      const prev = (db.prepare('SELECT prev_unit_cost_cents AS c FROM purchase_items WHERE purchase_id = ? AND product_id = ?').get(id, m.product_id) as any)?.c ?? null;
      applyMovement(db, { productId: m.product_id, deltaMilli: -m.qty_milli, type: 'estorno', reason: 'cancelamento_compra', occurredAt: at, unitCostCents: m.unit_cost_cents, purchaseId: id, reversesId: m.id, notes: `Cancelamento da compra #${cur.number}`, userId: ctx.userId });
      // Desfaz o efeito da compra no custo médio.
      const laterCostEntry = db.prepare(`SELECT 1 FROM stock_movements WHERE product_id = ? AND id > ? AND type = 'entrada' AND reason IN ('compra','saldo_inicial')`).get(m.product_id, m.id);
      let cost = p.unit_cost_cents;
      if (!laterCostEntry && prev !== null) cost = prev;             // nenhuma compra depois desta: volta exatamente ao custo anterior
      else {
        const rem = p.qty_milli - m.qty_milli;                          // houve compras depois: retira esta compra da média ponderada
        const val = p.qty_milli * p.unit_cost_cents - m.qty_milli * (m.unit_cost_cents ?? 0);
        if (rem > 0 && val >= 0) cost = Math.round(val / rem);
      }
      db.prepare('UPDATE products SET unit_cost_cents = ? WHERE id = ?').run(cost, m.product_id);
    }
    const paid = reverseAllPayments(ctx, 'pagamento', 'compra', id, now(db).date, `Estorno por cancelamento: ${reason.trim()}`);
    db.prepare(`UPDATE purchases SET status='cancelada', cancel_reason=?, cancelled_at=?, paid_cents=0, payment_status='pendente' WHERE id=?`).run(reason.trim(), at, id);
    audit(db, 'compra', id, 'cancelada', { motivo: reason.trim(), estornado: paid }, ctx.userId);
    return getPurchase(ctx, id);
  })();
}
