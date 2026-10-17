import { audit } from '../db';
import { calcOrderTotals, isLate, paymentStatus, ValidationError } from '../money';
import { syncOrderStock } from './recipes';
import { resolveOrderCustomer } from './customers';
import { resolveItemOptions } from './menu';
import { enqueuePrint } from './kitchen';
import { Ctx, NotFoundError, ForbiddenError, nextNumber, now, optDateTime, paidOn, paidSum, recordPayment, reqDate, reverseAllPayments } from './common';

export const ORDER_STATUSES = ['pendente', 'em_preparo', 'pronto', 'saiu_para_entrega', 'entregue', 'cancelado'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
const PICKUP_NO_DELIVERY = 'Pedido de retirada não sai para entrega. Quando o cliente buscar, marque como “Retirado”.';

export interface OrderInput {
  idempotencyKey?: string | null;
  orderDate: string;
  orderTime: string;
  source: 'presencial' | 'whatsapp';
  customerName?: string | null;
  customerPhone?: string | null;
  deliveryType: 'retirada' | 'entrega';
  address?: string | null;
  neighborhood?: string | null;
  // Cadastro de clientes
  customerId?: number | null;
  customerAddressId?: number | null;
  saveCustomer?: boolean;                 // telefone novo: cadastra o cliente junto com o pedido
  saveAddress?: { label: string } | null; // endereço digitado: salva no cadastro do cliente
  items: { size: string; qty: number; unitPriceCents: number; notes?: string | null; option?: string | null }[];
  deliveryFeeCents: number;
  deliveryCostCents: number;
  discountCents: number;
  paymentMethod?: string | null;
  paymentStatus: 'pendente' | 'parcial' | 'pago';
  paidCents?: number;
  status?: OrderStatus;
  expectedAt?: string | null;
  deliveredAt?: string | null;
  notes?: string | null;
}

function mapOrder(db: Ctx['db'], o: any) {
  const items = db.prepare('SELECT id, menu_option AS option, menu_description AS optionDescription, size, qty, unit_price_cents AS unitPriceCents, total_cents AS totalCents, notes FROM order_items WHERE order_id = ? ORDER BY id').all(o.id);
  const n = now(db).dateTime;
  return {
    id: o.id, number: o.number, orderDate: o.order_date, orderTime: o.order_time, source: o.source,
    customerName: o.customer_name, customerPhone: o.customer_phone, deliveryType: o.delivery_type, address: o.address, neighborhood: o.neighborhood ?? null, stockConsumed: !!o.stock_consumed,
    customerId: o.customer_id ?? null, customerAddressId: o.customer_address_id ?? null,
    subtotalCents: o.subtotal_cents, deliveryFeeCents: o.delivery_fee_cents, deliveryCostCents: o.delivery_cost_cents,
    discountCents: o.discount_cents, totalCents: o.total_cents, paymentMethod: o.payment_method, paidCents: o.paid_cents,
    paymentStatus: o.payment_status, status: o.status, expectedAt: o.expected_at, deliveredAt: o.delivered_at,
    notes: o.notes, cancelReason: o.cancel_reason, cancelledAt: o.cancelled_at,
    late: isLate({ status: o.status, expectedAt: o.expected_at }, n),
    items,
  };
}

function validate(input: OrderInput) {
  reqDate(input.orderDate, 'Data do pedido');
  if (!/^\d{2}:\d{2}$/.test(input.orderTime)) throw new ValidationError('Horário do pedido inválido.');
  if (!['presencial', 'whatsapp'].includes(input.source)) throw new ValidationError('Origem inválida.');
  if (!['retirada', 'entrega'].includes(input.deliveryType)) throw new ValidationError('Tipo de entrega inválido.');
  if (input.deliveryType === 'entrega' && !(input.address ?? '').trim()) throw new ValidationError('Informe o endereço de entrega.');
  const expectedAt = optDateTime(input.expectedAt, 'Horário previsto');
  const deliveredAt = optDateTime(input.deliveredAt, 'Horário real da entrega');
  const totals = calcOrderTotals(input.items, input.deliveryFeeCents, input.discountCents);
  if (!Number.isInteger(input.deliveryCostCents) || input.deliveryCostCents < 0) throw new ValidationError('Custo da entrega inválido.');
  return { expectedAt, deliveredAt, totals };
}

function insertItems(db: Ctx['db'], orderId: number, lines: any[], descriptions: (string | null)[]) {
  const ins = db.prepare('INSERT INTO order_items(order_id, menu_option, menu_description, size, qty, unit_price_cents, total_cents, notes) VALUES (?,?,?,?,?,?,?,?)');
  lines.forEach((l, i) => ins.run(orderId, l.option?.trim().slice(0, 40) || null, descriptions[i] ?? null, l.size, l.qty, l.unitPriceCents, l.totalCents, l.notes?.trim() || null));
}

/** Resolve cliente/endereço e substitui no input os dados que o pedido deve guardar (cópia no momento da compra). */
function applyCustomer(ctx: Ctx, input: OrderInput, legacyPhone?: string | null) {
  const r = resolveOrderCustomer(ctx, { ...input, legacyPhone });
  input.customerName = r.name;
  input.customerPhone = r.phone;
  if (input.deliveryType === 'entrega') { input.address = r.address; input.neighborhood = r.neighborhood; }
  return r;
}

export function createOrder(ctx: Ctx, input: OrderInput) {
  const { db } = ctx;
  return db.transaction(() => {
    if (input.idempotencyKey) {
      const ex = db.prepare('SELECT * FROM orders WHERE idempotency_key = ?').get(input.idempotencyKey);
      if (ex) return { ...mapOrder(db, ex), duplicate: true };
    }
    const cust = applyCustomer(ctx, input);
    const { expectedAt, deliveredAt, totals } = validate(input);
    const descriptions = resolveItemOptions(ctx, input.orderDate, input.items);
    const status: OrderStatus = input.status ?? 'pendente';
    if (!ORDER_STATUSES.includes(status)) throw new ValidationError('Status inválido.');
    if (status === 'cancelado') throw new ValidationError('Não é possível criar um pedido já cancelado.');
    if (status === 'saiu_para_entrega' && input.deliveryType === 'retirada') throw new ValidationError(PICKUP_NO_DELIVERY);
    if (status === 'entregue' && deliveredAt && ctx.role !== 'owner') throw new ForbiddenError('Somente o responsável pode informar manualmente o horário da entrega.');
    const delivered = status === 'entregue' ? (deliveredAt ?? now(db).dateTime) : null;

    let paid = 0;
    if (input.paymentStatus === 'pago') paid = totals.totalCents;
    else if (input.paymentStatus === 'parcial') {
      paid = input.paidCents ?? 0;
      if (!Number.isInteger(paid) || paid <= 0 || paid >= totals.totalCents) throw new ValidationError('Para pagamento parcial, informe um valor maior que zero e menor que o total.');
    }
    const number = nextNumber(db, 'orders');
    const res = db.prepare(`INSERT INTO orders (number, order_date, order_time, source, customer_name, customer_phone, delivery_type, address,
      subtotal_cents, delivery_fee_cents, delivery_cost_cents, discount_cents, total_cents, payment_method, paid_cents, payment_status,
      status, expected_at, delivered_at, notes, idempotency_key, created_by, neighborhood, customer_id, customer_address_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      number, input.orderDate, input.orderTime, input.source, input.customerName?.trim() || null, input.customerPhone?.trim() || null,
      input.deliveryType, input.deliveryType === 'entrega' ? input.address!.trim() : (input.address?.trim() || null),
      totals.subtotalCents, input.deliveryFeeCents, input.deliveryCostCents, input.discountCents, totals.totalCents,
      input.paymentMethod || null, paid, paymentStatus(totals.totalCents, paid), status, expectedAt, delivered,
      input.notes?.trim() || null, input.idempotencyKey || null, ctx.userId, input.deliveryType === 'entrega' ? (input.neighborhood?.trim() || null) : null,
      cust.customerId, input.deliveryType === 'entrega' ? cust.addressId : null);
    const id = Number(res.lastInsertRowid);
    insertItems(db, id, totals.lines, descriptions);
    if (paid > 0) {
      recordPayment(ctx, { kind: 'recebimento', refType: 'pedido', refId: id, amountCents: paid, method: input.paymentMethod, paidDate: paidOn(db, input.orderDate), notes: 'Recebimento registrado no cadastro do pedido' });
    }
    audit(db, 'pedido', id, 'criado', { number, total: totals.totalCents }, ctx.userId);
    syncOrderStock(ctx, id);
    enqueuePrint(db, id, 'novo'); // sai impresso na cozinha
    return { ...mapOrder(db, db.prepare('SELECT * FROM orders WHERE id = ?').get(id)), duplicate: false };
  })();
}

export function getOrder(ctx: Ctx, id: number) {
  const o = ctx.db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) throw new NotFoundError('Pedido não encontrado.');
  const payments = ctx.db.prepare(`SELECT id, amount_cents AS amountCents, method, paid_date AS paidDate, notes, created_at AS createdAt
    FROM payments WHERE ref_type='pedido' AND ref_id = ? ORDER BY id`).all(id);
  const history = ctx.db.prepare(`SELECT action, detail, at FROM audit_log WHERE entity='pedido' AND entity_id = ? ORDER BY id`).all(id);
  return { ...mapOrder(ctx.db, o), payments, history };
}

export function updateOrder(ctx: Ctx, id: number, input: OrderInput) {
  const { db } = ctx;
  return db.transaction(() => {
    const cur = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
    if (!cur) throw new NotFoundError('Pedido não encontrado.');
    if (cur.status === 'cancelado') throw new ValidationError('Pedido cancelado não pode ser editado. Reabra o pedido primeiro.');
    const cust = applyCustomer(ctx, input, cur.customer_phone);
    const { expectedAt, deliveredAt, totals } = validate(input);
    // opções que o pedido já tinha continuam valendo (mesmo se esgotaram depois), com a descrição da época
    const keep = new Map((db.prepare('SELECT menu_option, menu_description FROM order_items WHERE order_id = ? AND menu_option IS NOT NULL').all(id) as any[]).map((r) => [r.menu_option, r.menu_description]));
    const descriptions = resolveItemOptions(ctx, input.orderDate, input.items, keep);
    const paid = paidSum(db, 'pedido', id);
    if (paid > totals.totalCents) throw new ValidationError('O novo total é menor que o valor já recebido. Estorne parte do recebimento antes de reduzir o pedido.');
    let delivered = cur.delivered_at as string | null;
    if (deliveredAt !== null) {
      if (ctx.role !== 'owner' && deliveredAt !== cur.delivered_at) throw new ForbiddenError('Somente o responsável pode corrigir o horário real da entrega.');
      delivered = deliveredAt;
    }
    db.prepare(`UPDATE orders SET order_date=?, order_time=?, source=?, customer_name=?, customer_phone=?, delivery_type=?, address=?,
      subtotal_cents=?, delivery_fee_cents=?, delivery_cost_cents=?, discount_cents=?, total_cents=?, payment_method=?, paid_cents=?,
      payment_status=?, expected_at=?, delivered_at=?, notes=?, neighborhood=?, customer_id=?, customer_address_id=?, status=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(
      input.orderDate, input.orderTime, input.source, input.customerName?.trim() || null, input.customerPhone?.trim() || null,
      input.deliveryType, input.address?.trim() || null, totals.subtotalCents, input.deliveryFeeCents, input.deliveryCostCents,
      input.discountCents, totals.totalCents, input.paymentMethod || null, paid, paymentStatus(totals.totalCents, paid),
      expectedAt, delivered, input.notes?.trim() || null, input.deliveryType === 'entrega' ? (input.neighborhood?.trim() || null) : null,
      cust.customerId, input.deliveryType === 'entrega' ? cust.addressId : null,
      // virou retirada depois de já ter saído para entrega: volta para "pronto" (esperando o cliente buscar)
      input.deliveryType === 'retirada' && cur.status === 'saiu_para_entrega' ? 'pronto' : cur.status, id);
    // Corrigiu a forma de pagamento no pedido (ex.: marcou Pix mas foi Dinheiro): os recebimentos acompanham,
    // para o Caixa do dia contar certo. Só quando o pedido foi pago numa forma só (com duas formas, não dá para adivinhar).
    const newMethod = input.paymentMethod?.trim() || null;
    if (newMethod && newMethod !== cur.payment_method) {
      const methods = db.prepare("SELECT DISTINCT method FROM payments WHERE ref_type='pedido' AND ref_id=? AND method IS NOT NULL").all(id) as any[];
      if (methods.length <= 1) {
        const n = db.prepare("UPDATE payments SET method=? WHERE ref_type='pedido' AND ref_id=?").run(newMethod, id).changes;
        if (n) audit(db, 'pedido', id, 'forma_pagamento', { de: methods[0]?.method ?? null, para: newMethod, recebimentos: n }, ctx.userId);
      }
    }
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);
    insertItems(db, id, totals.lines, descriptions);
    audit(db, 'pedido', id, 'editado', { totalAntes: cur.total_cents, totalDepois: totals.totalCents }, ctx.userId);
    syncOrderStock(ctx, id, { edited: true });
    enqueuePrint(db, id, 'alterado');
    return getOrder(ctx, id);
  })();
}

export function setOrderStatus(ctx: Ctx, id: number, status: OrderStatus, opts: { reason?: string; deliveredAt?: string | null } = {}) {
  const { db } = ctx;
  if (!ORDER_STATUSES.includes(status)) throw new ValidationError('Status inválido.');
  return db.transaction(() => {
    const cur = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
    if (!cur) throw new NotFoundError('Pedido não encontrado.');
    if (cur.status === status) return getOrder(ctx, id);
    if (cur.status === 'cancelado' && status !== 'pendente') throw new ValidationError('Um pedido cancelado só pode ser reaberto como "Pendente".');
    if (status === 'saiu_para_entrega' && cur.delivery_type === 'retirada') throw new ValidationError(PICKUP_NO_DELIVERY);
    if (status === 'cancelado') {
      if (!opts.reason?.trim()) throw new ValidationError('Informe o motivo do cancelamento.');
      const paid = reverseAllPayments(ctx, 'recebimento', 'pedido', id, now(db).date, `Estorno por cancelamento: ${opts.reason.trim()}`);
      db.prepare(`UPDATE orders SET status='cancelado', cancel_reason=?, cancelled_at=?, paid_cents=0, payment_status='pendente', delivered_at=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
        .run(opts.reason.trim(), now(db).dateTime, id);
      audit(db, 'pedido', id, 'cancelado', { motivo: opts.reason.trim(), estornado: paid }, ctx.userId);
      syncOrderStock(ctx, id);
      enqueuePrint(db, id, 'cancelado');
    } else {
      let delivered: string | null = null;
      if (status === 'entregue') {
        const manual = optDateTime(opts.deliveredAt, 'Horário real da entrega');
        if (manual && ctx.role !== 'owner') throw new ForbiddenError('Somente o responsável pode informar manualmente o horário da entrega.');
        delivered = manual ?? now(db).dateTime;
      }
      db.prepare(`UPDATE orders SET status=?, delivered_at=?, cancel_reason=NULL, cancelled_at=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
        .run(status, delivered, id);
      audit(db, 'pedido', id, cur.status === 'cancelado' ? 'reaberto' : 'status', { de: cur.status, para: status }, ctx.userId);
      syncOrderStock(ctx, id);
      if (cur.status === 'cancelado') enqueuePrint(db, id, 'reaberto');
    }
    return getOrder(ctx, id);
  })();
}

export function addOrderPayment(ctx: Ctx, id: number, p: { amountCents: number; method?: string | null; paidDate?: string }) {
  const { db } = ctx;
  return db.transaction(() => {
    const cur = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
    if (!cur) throw new NotFoundError('Pedido não encontrado.');
    if (cur.status === 'cancelado') throw new ValidationError('Pedido cancelado não recebe pagamentos.');
    if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new ValidationError('Valor do recebimento inválido.');
    const paid = paidSum(db, 'pedido', id);
    if (paid + p.amountCents > cur.total_cents) throw new ValidationError('O recebimento ultrapassa o total do pedido.');
    // sem escolher a forma, vale a forma do pedido (senão o dinheiro some da conta da gaveta)
    recordPayment(ctx, { kind: 'recebimento', refType: 'pedido', refId: id, amountCents: p.amountCents, method: p.method || cur.payment_method, paidDate: p.paidDate ? reqDate(p.paidDate, 'Data do recebimento') : now(db).date });
    const np = paid + p.amountCents;
    db.prepare('UPDATE orders SET paid_cents=?, payment_status=?, payment_method=COALESCE(?, payment_method) WHERE id=?').run(np, paymentStatus(cur.total_cents, np), p.method || null, id);
    audit(db, 'pedido', id, 'recebimento', { valor: p.amountCents }, ctx.userId);
    return getOrder(ctx, id);
  })();
}

export function reverseOrderPayment(ctx: Ctx, orderId: number, paymentId: number) {
  const { db } = ctx;
  return db.transaction(() => {
    const pay = db.prepare(`SELECT * FROM payments WHERE id=? AND ref_type='pedido' AND ref_id=?`).get(paymentId, orderId) as any;
    if (!pay) throw new NotFoundError('Recebimento não encontrado.');
    if (pay.amount_cents <= 0) throw new ValidationError('Este lançamento já é um estorno.');
    const already = db.prepare(`SELECT 1 FROM payments WHERE ref_type='pedido' AND ref_id=? AND notes = ?`).get(orderId, `Estorno do recebimento #${paymentId}`);
    if (already) throw new ValidationError('Este recebimento já foi estornado.');
    recordPayment(ctx, { kind: 'recebimento', refType: 'pedido', refId: orderId, amountCents: -pay.amount_cents, method: pay.method, paidDate: now(db).date, notes: `Estorno do recebimento #${paymentId}` });
    const cur = db.prepare('SELECT total_cents FROM orders WHERE id=?').get(orderId) as any;
    const np = paidSum(db, 'pedido', orderId);
    db.prepare('UPDATE orders SET paid_cents=?, payment_status=? WHERE id=?').run(np, paymentStatus(cur.total_cents, np), orderId);
    audit(db, 'pedido', orderId, 'estorno_recebimento', { pagamento: paymentId }, ctx.userId);
    return getOrder(ctx, orderId);
  })();
}

export interface OrderFilters {
  date?: string; from?: string; to?: string; source?: string; status?: string; size?: string;
  customer?: string; payment?: string; paymentStatus?: string; q?: string; late?: boolean;
  page?: number; pageSize?: number;
}

export function listOrders(ctx: Ctx, f: OrderFilters) {
  const { db } = ctx;
  const where: string[] = [];
  const args: any[] = [];
  if (f.date) { where.push('o.order_date = ?'); args.push(f.date); }
  if (f.from) { where.push('o.order_date >= ?'); args.push(f.from); }
  if (f.to) { where.push('o.order_date <= ?'); args.push(f.to); }
  if (f.source) { where.push('o.source = ?'); args.push(f.source); }
  if (f.status) { where.push('o.status = ?'); args.push(f.status); }
  if (f.payment) { where.push('o.payment_method = ?'); args.push(f.payment); }
  if (f.paymentStatus) { where.push('o.payment_status = ?'); args.push(f.paymentStatus); }
  if (f.customer) { where.push('o.customer_name LIKE ?'); args.push(`%${f.customer}%`); }
  if (f.size) { where.push('EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.size = ?)'); args.push(f.size); }
  if (f.q) {
    const digits = f.q.replace(/\D/g, '');
    where.push(`(CAST(o.number AS TEXT) = ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?
      OR (? != '' AND (REPLACE(REPLACE(REPLACE(REPLACE(o.customer_phone,'(',''),')',''),'-',''),' ','') LIKE ? OR o.customer_id IN (SELECT id FROM customers WHERE phone LIKE ?))))`);
    args.push(f.q.replace(/^#/, ''), `%${f.q}%`, `%${f.q}%`, digits.length >= 4 ? digits : '', `%${digits}%`, `%${digits}%`);
  }
  if (f.late) {
    where.push(`o.status NOT IN ('entregue','cancelado') AND o.expected_at IS NOT NULL AND o.expected_at < ?`);
    args.push(now(db).dateTime);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const pageSize = Number.isInteger(f.pageSize) ? Math.min(Math.max(f.pageSize!, 1), 200) : 20;
  const page = Number.isInteger(f.page) && f.page! > 0 ? f.page! : 1;
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM orders o ${w}`).get(...args) as any).c;
  const rows = db.prepare(`SELECT o.* FROM orders o ${w} ORDER BY o.order_date DESC, o.order_time DESC, o.id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (page - 1) * pageSize);
  return { total, page, pageSize, rows: rows.map((r) => mapOrder(db, r)) };
}
