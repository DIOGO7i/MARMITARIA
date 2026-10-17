// Clientes e endereços. Telefone é a chave de busca e é único (sem duplicidade).
import { audit } from '../db';
import { ValidationError } from '../money';
import { formatPhone, normalizePhone } from '../phone';
import { Ctx, NotFoundError } from './common';

export class ConflictError extends Error { status = 409; constructor(message: string, public existingId: number) { super(message); } }

export interface AddressInput { label: string; street: string; complement?: string | null; neighborhood?: string | null; reference?: string | null }

const clean = (s: unknown, max = 200) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : null);

function checkAddress(a: AddressInput) {
  if (!clean(a.label, 40)) throw new ValidationError('Informe o nome do endereço (ex.: Casa, Trabalho).');
  if (!clean(a.street)) throw new ValidationError('Informe a rua e o número do endereço.');
}

/** Texto do endereço que vai para o pedido (cópia feita no momento da compra). */
export function addressText(a: { street: string; complement?: string | null; reference?: string | null }) {
  return [a.street, a.complement, a.reference ? `ref.: ${a.reference}` : null].filter(Boolean).join(' — ');
}

const mapAddress = (a: any) => ({
  id: a.id, customerId: a.customer_id, label: a.label, street: a.street, complement: a.complement, neighborhood: a.neighborhood,
  reference: a.reference, text: addressText(a),
});

function stats(ctx: Ctx, customerId: number) {
  return ctx.db.prepare(`SELECT COUNT(*) AS orders, MAX(order_date || 'T' || order_time) AS lastOrderAt,
      COALESCE(SUM(CASE WHEN status != 'cancelado' THEN total_cents END), 0) AS totalSpentCents
    FROM orders WHERE customer_id = ?`).get(customerId) as { orders: number; lastOrderAt: string | null; totalSpentCents: number };
}

function mapCustomer(ctx: Ctx, c: any, withAddresses = true) {
  return {
    id: c.id, name: c.name, phone: c.phone, phoneFormatted: formatPhone(c.phone), notes: c.notes, createdAt: c.created_at,
    ...stats(ctx, c.id),
    addresses: withAddresses ? (ctx.db.prepare('SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY id').all(c.id) as any[]).map(mapAddress) : undefined,
  };
}

export function findByPhone(ctx: Ctx, rawPhone: string) {
  const phone = normalizePhone(rawPhone);
  const c = ctx.db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
  if (!c) return { phone, phoneFormatted: formatPhone(phone), customer: null };
  const last = ctx.db.prepare(`SELECT customer_address_id AS addressId, delivery_type AS deliveryType FROM orders
    WHERE customer_id = ? AND status != 'cancelado' ORDER BY id DESC LIMIT 1`).get((c as any).id) as any;
  return { phone, phoneFormatted: formatPhone(phone), customer: { ...mapCustomer(ctx, c), lastAddressId: last?.addressId ?? null, lastDeliveryType: last?.deliveryType ?? null } };
}

export function getCustomer(ctx: Ctx, id: number) {
  const c = ctx.db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!c) throw new NotFoundError('Cliente não encontrado.');
  const orders = ctx.db.prepare(`SELECT o.id, o.number, o.order_date AS orderDate, o.order_time AS orderTime, o.status, o.delivery_type AS deliveryType,
      o.address, o.neighborhood, o.total_cents AS totalCents, o.payment_status AS paymentStatus,
      (SELECT GROUP_CONCAT(qty || 'x ' || size || COALESCE(' (' || menu_option || ')', ''), ', ') FROM order_items i WHERE i.order_id = o.id) AS itemsText
    FROM orders o WHERE o.customer_id = ? ORDER BY o.order_date DESC, o.order_time DESC, o.id DESC LIMIT 200`).all(id);
  return { ...mapCustomer(ctx, c), orderHistory: orders };
}

export function listCustomers(ctx: Ctx, f: { q?: string; page?: number; pageSize?: number }) {
  const where: string[] = []; const args: any[] = [];
  if (f.q?.trim()) {
    const digits = f.q.replace(/\D/g, '');
    if (digits.length >= 3) { where.push('(c.phone LIKE ? OR c.name LIKE ?)'); args.push(`%${digits.replace(/^55(?=\d{10,11}$)/, '')}%`, `%${f.q.trim()}%`); }
    else { where.push('c.name LIKE ?'); args.push(`%${f.q.trim()}%`); }
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
  const page = Math.max(f.page ?? 1, 1);
  const total = (ctx.db.prepare(`SELECT COUNT(*) AS n FROM customers c ${w}`).get(...args) as any).n;
  const rows = ctx.db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM customer_addresses a WHERE a.customer_id = c.id) AS addr_count
    FROM customers c ${w} ORDER BY c.name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize) as any[];
  return { total, page, pageSize, rows: rows.map((c) => ({ ...mapCustomer(ctx, c, false), addressCount: c.addr_count })) };
}

/** Cria cliente. Se o telefone já existir, NÃO cria outro: lança ConflictError com o id do existente. */
export function createCustomer(ctx: Ctx, i: { name: string; phone: string; notes?: string | null; addresses?: AddressInput[] }) {
  const { db } = ctx;
  const name = clean(i.name, 120);
  if (!name) throw new ValidationError('Informe o nome do cliente.');
  const phone = normalizePhone(i.phone);
  for (const a of i.addresses ?? []) checkAddress(a);
  return db.transaction(() => {
    const ex = db.prepare('SELECT id, name FROM customers WHERE phone = ?').get(phone) as any;
    if (ex) throw new ConflictError(`Este telefone já está cadastrado para ${ex.name}.`, ex.id);
    const id = Number(db.prepare('INSERT INTO customers(name, phone, notes, created_by) VALUES (?,?,?,?)').run(name, phone, clean(i.notes, 500), ctx.userId).lastInsertRowid);
    for (const a of i.addresses ?? []) insertAddress(ctx, id, a);
    audit(db, 'cliente', id, 'criado', null, ctx.userId);
    return getCustomer(ctx, id);
  })();
}

export function updateCustomer(ctx: Ctx, id: number, i: { name: string; phone: string; notes?: string | null }) {
  const { db } = ctx;
  const name = clean(i.name, 120);
  if (!name) throw new ValidationError('Informe o nome do cliente.');
  const phone = normalizePhone(i.phone);
  return db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id)) throw new NotFoundError('Cliente não encontrado.');
    const ex = db.prepare('SELECT id, name FROM customers WHERE phone = ? AND id != ?').get(phone, id) as any;
    if (ex) throw new ConflictError(`Este telefone já pertence a outro cliente (${ex.name}).`, ex.id);
    db.prepare("UPDATE customers SET name=?, phone=?, notes=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(name, phone, clean(i.notes, 500), id);
    audit(db, 'cliente', id, 'editado', null, ctx.userId);
    return getCustomer(ctx, id);
  })();
}

function insertAddress(ctx: Ctx, customerId: number, a: AddressInput) {
  checkAddress(a);
  return Number(ctx.db.prepare('INSERT INTO customer_addresses(customer_id, label, street, complement, neighborhood, reference) VALUES (?,?,?,?,?,?)')
    .run(customerId, clean(a.label, 40), clean(a.street), clean(a.complement), clean(a.neighborhood, 80), clean(a.reference)).lastInsertRowid);
}

export function addAddress(ctx: Ctx, customerId: number, a: AddressInput) {
  if (!ctx.db.prepare('SELECT 1 FROM customers WHERE id = ?').get(customerId)) throw new NotFoundError('Cliente não encontrado.');
  const id = insertAddress(ctx, customerId, a);
  audit(ctx.db, 'cliente', customerId, 'endereco_adicionado', { endereco: id }, ctx.userId);
  return { address: getAddress(ctx, customerId, id), customer: getCustomer(ctx, customerId) };
}

/** Busca o endereço garantindo que ele pertence a ESTE cliente. */
export function getAddress(ctx: Ctx, customerId: number, addressId: number) {
  const a = ctx.db.prepare('SELECT * FROM customer_addresses WHERE id = ? AND customer_id = ?').get(addressId, customerId);
  if (!a) throw new NotFoundError('Endereço não encontrado para este cliente.');
  return mapAddress(a);
}

export function updateAddress(ctx: Ctx, customerId: number, addressId: number, a: AddressInput) {
  checkAddress(a);
  getAddress(ctx, customerId, addressId);
  ctx.db.prepare("UPDATE customer_addresses SET label=?, street=?, complement=?, neighborhood=?, reference=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND customer_id=?")
    .run(clean(a.label, 40), clean(a.street), clean(a.complement), clean(a.neighborhood, 80), clean(a.reference), addressId, customerId);
  audit(ctx.db, 'cliente', customerId, 'endereco_editado', { endereco: addressId }, ctx.userId);
  return getCustomer(ctx, customerId);
}

export function deleteAddress(ctx: Ctx, customerId: number, addressId: number) {
  const { db } = ctx;
  getAddress(ctx, customerId, addressId);
  db.transaction(() => {
    // Pedidos antigos mantêm a cópia do endereço; só perdem a referência ao cadastro.
    db.prepare('UPDATE orders SET customer_address_id = NULL WHERE customer_address_id = ?').run(addressId);
    db.prepare('DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?').run(addressId, customerId);
    audit(db, 'cliente', customerId, 'endereco_excluido', { endereco: addressId }, ctx.userId);
  })();
  return getCustomer(ctx, customerId);
}

/** Exclui o cadastro (pedido do cliente / LGPD). Pedidos antigos continuam no histórico financeiro, sem vínculo com o cadastro. */
export function deleteCustomer(ctx: Ctx, id: number) {
  const { db } = ctx;
  if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id)) throw new NotFoundError('Cliente não encontrado.');
  db.transaction(() => {
    db.prepare('UPDATE orders SET customer_id = NULL, customer_address_id = NULL WHERE customer_id = ?').run(id);
    db.prepare('DELETE FROM customer_addresses WHERE customer_id = ?').run(id);
    db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    audit(db, 'cliente', id, 'excluido', null, ctx.userId);
  })();
  return { ok: true };
}

/**
 * Usado DENTRO da transação do pedido: resolve cliente e endereço e devolve o que o pedido deve guardar.
 * - customerId informado: valida; se veio customerAddressId, confere que é desse cliente e usa a cópia do endereço salvo.
 * - Sem customerId mas com saveCustomer: procura pelo telefone (nunca duplica) ou cria o cliente.
 * - saveAddress: grava o endereço digitado no cadastro do cliente.
 */
export function resolveOrderCustomer(ctx: Ctx, i: {
  customerId?: number | null; customerAddressId?: number | null; saveCustomer?: boolean;
  saveAddress?: { label: string; street?: string | null; complement?: string | null; reference?: string | null } | null; customerName?: string | null; customerPhone?: string | null;
  deliveryType: 'retirada' | 'entrega'; address?: string | null; neighborhood?: string | null;
  legacyPhone?: string | null; // telefone já gravado num pedido antigo (antes da validação): pode ser mantido como está
}) {
  const { db } = ctx;
  let customerId: number | null = null;
  let addressId: number | null = null;
  let name = clean(i.customerName, 120);
  let phone: string | null = null;
  let address = clean(i.address, 300);
  let neighborhood = clean(i.neighborhood, 80);

  let keepRawPhone = false;
  if (i.customerPhone && String(i.customerPhone).replace(/\D/g, '')) {
    try { phone = normalizePhone(i.customerPhone); }
    catch (e) {
      if (i.legacyPhone && String(i.customerPhone).trim() === i.legacyPhone.trim() && !i.customerId && !i.saveCustomer) keepRawPhone = true;
      else throw e;
    }
  }

  if (i.customerId) {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(i.customerId) as any;
    if (!c) throw new NotFoundError('Cliente do pedido não encontrado.');
    customerId = c.id; name = name ?? c.name; phone = c.phone;
  } else if (i.saveCustomer) {
    if (!phone) throw new ValidationError('Para cadastrar o cliente, informe o telefone com DDD.');
    const ex = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone) as any;
    if (ex) { customerId = ex.id; name = name ?? ex.name; }
    else {
      if (!name) throw new ValidationError('Para cadastrar o cliente, informe o nome.');
      customerId = Number(db.prepare('INSERT INTO customers(name, phone, created_by) VALUES (?,?,?)').run(name, phone, ctx.userId).lastInsertRowid);
      audit(db, 'cliente', customerId, 'criado_no_pedido', null, ctx.userId);
    }
  }

  if (i.deliveryType === 'entrega') {
    if (i.customerAddressId) {
      if (!customerId) throw new ValidationError('Endereço salvo informado sem cliente.');
      const a = db.prepare('SELECT * FROM customer_addresses WHERE id = ? AND customer_id = ?').get(i.customerAddressId, customerId) as any;
      if (!a) throw new ValidationError('O endereço escolhido não pertence a este cliente. Selecione o endereço novamente.');
      addressId = a.id; address = addressText(a); neighborhood = a.neighborhood ?? neighborhood;
    } else if (i.saveAddress && customerId && (clean(i.saveAddress.street) || address)) {
      const sa = i.saveAddress;
      const struct = clean(sa.street) ? { street: clean(sa.street)!, complement: clean(sa.complement), reference: clean(sa.reference) } : { street: address!, complement: null, reference: null };
      address = addressText(struct);
      const dup = db.prepare(`SELECT id FROM customer_addresses WHERE customer_id = ? AND LOWER(street) = LOWER(?) AND COALESCE(complement, '') = COALESCE(?, '')
        AND COALESCE(neighborhood, '') = COALESCE(?, '')`).get(customerId, struct.street, struct.complement, neighborhood) as any;
      addressId = dup?.id ?? insertAddress(ctx, customerId, { label: sa.label || 'Casa', ...struct, neighborhood });
    }
  }
  return { customerId, addressId, name, phone: phone ? formatPhone(phone) : keepRawPhone ? clean(i.customerPhone, 30) : null, address, neighborhood };
}
