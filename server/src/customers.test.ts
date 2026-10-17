import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { openDb } from './db';
import { normalizePhone, formatPhone } from './phone';
import { createCustomer, findByPhone, getCustomer, listCustomers, addAddress, updateAddress, deleteAddress, updateCustomer, deleteCustomer } from './services/customers';
import { createOrder, getOrder, updateOrder, listOrders } from './services/orders';
import type { Ctx } from './services/common';

let ctx: Ctx;
beforeEach(() => { ctx = { db: openDb(':memory:'), userId: null, role: 'owner' }; });
const base = (over: any = {}) => ({
  orderDate: '2026-10-12', orderTime: '12:00', source: 'whatsapp' as const, deliveryType: 'retirada' as const,
  items: [{ size: '450 g', qty: 1, unitPriceCents: 2200 }], deliveryFeeCents: 0, deliveryCostCents: 0, discountCents: 0, paymentStatus: 'pendente' as const, ...over,
});

describe('telefone', () => {
  it('aceita formatos comuns e normaliza', () => {
    expect(normalizePhone('(11) 98888-7777')).toBe('11988887777');
    expect(normalizePhone('+55 11 98888 7777')).toBe('11988887777');
    expect(normalizePhone('11 3333-4444')).toBe('1133334444');
    expect(formatPhone('11988887777')).toBe('(11) 98888-7777');
  });
  it('recusa com mensagem clara', () => {
    expect(() => normalizePhone('98888-7777')).toThrow(/DDD/);
    expect(() => normalizePhone('123')).toThrow(/inválido/);
    expect(() => normalizePhone('(20) 98888-7777')).toThrow(/DDD 20/);
    expect(() => normalizePhone('(11) 88888-7777')).toThrow(/começar com 9/);
  });
});

describe('cadastro e busca de clientes', () => {
  it('cadastra cliente novo com endereços e encontra pelo telefone em qualquer formato', () => {
    const c = createCustomer(ctx, { name: 'Maria Souza', phone: '(11) 98888-7777', addresses: [
      { label: 'Casa', street: 'Rua das Flores, 100', complement: 'Apto 12', neighborhood: 'Centro', reference: 'Perto da padaria' },
      { label: 'Trabalho', street: 'Av. Brasil, 2000', neighborhood: 'Jardim América' },
    ] });
    expect(c.phone).toBe('11988887777');
    expect(c.addresses).toHaveLength(2);
    expect(c.addresses![0].text).toBe('Rua das Flores, 100 — Apto 12 — ref.: Perto da padaria');
    const f = findByPhone(ctx, '+55 (11) 98888-7777');
    expect(f.customer?.name).toBe('Maria Souza');
    expect(f.customer?.addresses).toHaveLength(2);
    expect(findByPhone(ctx, '11 97777-6666').customer).toBeNull();
    expect(listCustomers(ctx, { q: '98888' }).total).toBe(1);
    expect(listCustomers(ctx, { q: 'maria' }).total).toBe(1);
  });

  it('não duplica: mesmo telefone em outro formato é recusado e informa o cliente existente', () => {
    const c = createCustomer(ctx, { name: 'Maria', phone: '11988887777' });
    try { createCustomer(ctx, { name: 'Outra Maria', phone: '(11) 98888-7777' }); expect.fail('deveria recusar'); }
    catch (e: any) { expect(e.status).toBe(409); expect(e.existingId).toBe(c.id); expect(e.message).toMatch(/já está cadastrado/); }
    const b = createCustomer(ctx, { name: 'João', phone: '11977776666' });
    expect(() => updateCustomer(ctx, b.id, { name: 'João', phone: '11 98888-7777' })).toThrow(/outro cliente/);
    expect(listCustomers(ctx, {}).total).toBe(2);
  });

  it('valida campos obrigatórios', () => {
    expect(() => createCustomer(ctx, { name: '  ', phone: '11988887777' })).toThrow(/nome/);
    expect(() => createCustomer(ctx, { name: 'Ana', phone: '988887777' })).toThrow(/DDD/);
    const c = createCustomer(ctx, { name: 'Ana', phone: '11988887777' });
    expect(() => addAddress(ctx, c.id, { label: 'Casa', street: '' })).toThrow(/rua/);
    expect(() => addAddress(ctx, c.id, { label: '', street: 'Rua A, 1' })).toThrow(/nome do endereço/);
  });
});

describe('endereços', () => {
  it('adiciona, edita e exclui; cada endereço só pode ser mexido pelo próprio cliente', () => {
    const a = createCustomer(ctx, { name: 'Ana', phone: '11988887777' });
    const b = createCustomer(ctx, { name: 'Bia', phone: '11977776666' });
    const r1 = addAddress(ctx, a.id, { label: 'Casa', street: 'Rua 1, 10', neighborhood: 'Centro' });
    addAddress(ctx, a.id, { label: 'Trabalho', street: 'Rua 2, 20', neighborhood: 'Vila Nova' });
    expect(getCustomer(ctx, a.id).addresses).toHaveLength(2);
    updateAddress(ctx, a.id, r1.address.id, { label: 'Casa nova', street: 'Rua 1, 11', neighborhood: 'Centro' });
    expect(getCustomer(ctx, a.id).addresses![0]).toMatchObject({ label: 'Casa nova', street: 'Rua 1, 11' });
    expect(() => updateAddress(ctx, b.id, r1.address.id, { label: 'x', street: 'y' })).toThrow(/não encontrado para este cliente/);
    expect(() => deleteAddress(ctx, b.id, r1.address.id)).toThrow(/não encontrado para este cliente/);
    deleteAddress(ctx, a.id, r1.address.id);
    expect(getCustomer(ctx, a.id).addresses!.map((x) => x.label)).toEqual(['Trabalho']);
  });
});

describe('pedido integrado ao cliente', () => {
  it('pedido com endereço salvo guarda a cópia do endereço; editar/excluir o endereço depois não muda o pedido', () => {
    const c = createCustomer(ctx, { name: 'Maria', phone: '11988887777', addresses: [{ label: 'Casa', street: 'Rua das Flores, 100', neighborhood: 'Centro' }] });
    const addr = c.addresses![0];
    const o = createOrder(ctx, base({ customerId: c.id, customerAddressId: addr.id, deliveryType: 'entrega', address: 'qualquer coisa', neighborhood: 'Outro', deliveryFeeCents: 500, deliveryCostCents: 400 }));
    expect(o.customerId).toBe(c.id);
    expect(o.customerAddressId).toBe(addr.id);
    expect(o.address).toBe('Rua das Flores, 100'); // o servidor usa o endereço salvo, não o texto enviado
    expect(o.neighborhood).toBe('Centro');
    expect(o.customerName).toBe('Maria');
    expect(o.customerPhone).toBe('(11) 98888-7777');
    updateAddress(ctx, c.id, addr.id, { label: 'Casa', street: 'Rua Nova, 999', neighborhood: 'Jardim' });
    expect(getOrder(ctx, o.id).address).toBe('Rua das Flores, 100');
    deleteAddress(ctx, c.id, addr.id);
    const after = getOrder(ctx, o.id);
    expect(after.address).toBe('Rua das Flores, 100');
    expect(after.customerAddressId).toBeNull();
    expect(getCustomer(ctx, c.id).orderHistory).toHaveLength(1); // histórico preservado
  });

  it('recusa endereço de outro cliente', () => {
    const a = createCustomer(ctx, { name: 'Ana', phone: '11988887777', addresses: [{ label: 'Casa', street: 'Rua A, 1' }] });
    const b = createCustomer(ctx, { name: 'Bia', phone: '11977776666' });
    expect(() => createOrder(ctx, base({ customerId: b.id, customerAddressId: a.addresses![0].id, deliveryType: 'entrega', address: 'x' }))).toThrow(/não pertence a este cliente/);
  });

  it('telefone novo: cadastra o cliente e o endereço junto com o pedido (atômico, sem duplicar)', () => {
    const o = createOrder(ctx, base({ customerName: 'Carlos Lima', customerPhone: '(21) 99999-1234', saveCustomer: true, deliveryType: 'entrega',
      address: 'Rua do Sol, 50', neighborhood: 'Centro', saveAddress: { label: 'Casa' } }));
    expect(o.customerId).toBeTruthy();
    const c = getCustomer(ctx, o.customerId!);
    expect(c).toMatchObject({ name: 'Carlos Lima', phone: '21999991234' });
    expect(c.addresses).toHaveLength(1);
    expect(o.customerAddressId).toBe(c.addresses![0].id);
    // segundo pedido com o mesmo telefone e saveCustomer: reaproveita o cadastro e não duplica o endereço
    const o2 = createOrder(ctx, base({ customerName: 'Carlos', customerPhone: '21999991234', saveCustomer: true, deliveryType: 'entrega', address: 'Rua do Sol, 50', neighborhood: 'Centro', saveAddress: { label: 'Casa' } }));
    expect(o2.customerId).toBe(o.customerId);
    expect(getCustomer(ctx, o.customerId!).addresses).toHaveLength(1);
    expect(listCustomers(ctx, {}).total).toBe(1);
    // se o pedido falhar, o cliente novo não fica cadastrado pela metade
    expect(() => createOrder(ctx, base({ customerName: 'Zé', customerPhone: '31988887777', saveCustomer: true, discountCents: 999999 }))).toThrow(/negativo/);
    expect(findByPhone(ctx, '31988887777').customer).toBeNull();
  });

  it('endereço novo digitado no pedido é salvo separado em rua, complemento e referência', () => {
    const o = createOrder(ctx, base({ customerName: 'Rita', customerPhone: '11966665555', saveCustomer: true, deliveryType: 'entrega', neighborhood: 'Centro',
      address: 'ignorado', saveAddress: { label: 'Trabalho', street: 'Av. Paulista, 1000', complement: 'Sala 5', reference: 'Prédio azul' } }));
    expect(o.address).toBe('Av. Paulista, 1000 — Sala 5 — ref.: Prédio azul');
    expect(getCustomer(ctx, o.customerId!).addresses![0]).toMatchObject({ label: 'Trabalho', street: 'Av. Paulista, 1000', complement: 'Sala 5', reference: 'Prédio azul', neighborhood: 'Centro' });
  });

  it('valida telefone no pedido e exige nome para cadastrar', () => {
    expect(() => createOrder(ctx, base({ customerPhone: '98888-7777' }))).toThrow(/DDD/);
    expect(() => createOrder(ctx, base({ customerPhone: '11988887777', saveCustomer: true }))).toThrow(/nome/);
    expect(createOrder(ctx, base()).customerId).toBeNull(); // pedido sem cliente continua possível (balcão)
  });

  it('histórico do cliente lista pedidos com o endereço usado em cada um; busca de pedidos acha pelo telefone', () => {
    const c = createCustomer(ctx, { name: 'Maria', phone: '11988887777', addresses: [{ label: 'Casa', street: 'Rua 1, 10', neighborhood: 'Centro' }, { label: 'Trabalho', street: 'Rua 2, 20', neighborhood: 'Vila' }] });
    createOrder(ctx, base({ customerId: c.id, customerAddressId: c.addresses![0].id, deliveryType: 'entrega' }));
    createOrder(ctx, base({ customerId: c.id, customerAddressId: c.addresses![1].id, deliveryType: 'entrega', orderTime: '13:00' }));
    createOrder(ctx, base({ customerId: c.id, orderTime: '14:00' }));
    const h = getCustomer(ctx, c.id);
    expect(h.orderHistory.map((o: any) => o.address)).toEqual([null, 'Rua 2, 20', 'Rua 1, 10']);
    expect(h.orderHistory).toHaveLength(3); expect(h.orders).toBe(3);
    expect(listOrders(ctx, { q: '988887777' }).total).toBe(3);
    expect(findByPhone(ctx, '11988887777').customer?.lastAddressId).toBeNull(); // último pedido foi retirada
  });

  it('editar pedido antigo com telefone sem DDD (de antes da validação) continua possível', () => {
    const id = Number(ctx.db.prepare(`INSERT INTO orders(number, order_date, order_time, source, customer_phone, delivery_type, subtotal_cents, total_cents)
      VALUES (99, '2026-10-01', '12:00', 'presencial', '9888-7777', 'retirada', 2200, 2200)`).run().lastInsertRowid);
    ctx.db.prepare("INSERT INTO order_items(order_id, size, qty, unit_price_cents, total_cents) VALUES (?, '450 g', 1, 2200, 2200)").run(id);
    const full = getOrder(ctx, id) as any;
    expect(updateOrder(ctx, id, { ...full, notes: 'ok', deliveredAt: null }).notes).toBe('ok');
  });

  it('excluir cliente remove cadastro e endereços e mantém os pedidos no histórico financeiro', () => {
    const c = createCustomer(ctx, { name: 'Maria', phone: '11988887777', addresses: [{ label: 'Casa', street: 'Rua 1, 10' }] });
    const o = createOrder(ctx, base({ customerId: c.id, customerAddressId: c.addresses![0].id, deliveryType: 'entrega' }));
    deleteCustomer(ctx, c.id);
    expect(findByPhone(ctx, '11988887777').customer).toBeNull();
    expect(getOrder(ctx, o.id)).toMatchObject({ customerId: null, address: 'Rua 1, 10' });
  });
});

describe('migração de pedidos antigos', () => {
  it('cria clientes a partir de pedidos já existentes (uma vez), sem duplicar e com os endereços usados', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-')), 'old.db');
    const db = openDb(file);
    db.prepare("DELETE FROM settings WHERE key = 'migr_clientes'").run();
    const ins = db.prepare(`INSERT INTO orders(number, order_date, order_time, source, customer_name, customer_phone, delivery_type, address, neighborhood, subtotal_cents, total_cents)
      VALUES (?, '2026-10-01', '12:00', 'whatsapp', ?, ?, ?, ?, ?, 2200, 2200)`);
    ins.run(1, 'João', '(11) 98888-7777', 'entrega', 'Rua A, 1', 'Centro');
    ins.run(2, 'João Silva', '11988887777', 'entrega', 'Rua A, 1', 'Centro');
    ins.run(3, 'João Silva', '11 98888-7777', 'entrega', 'Rua B, 2', 'Vila');
    ins.run(4, 'Sem DDD', '8888-7777', 'retirada', null, null);
    db.close();
    const db2 = openDb(file);
    const c = db2.prepare('SELECT * FROM customers').all() as any[];
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ name: 'João Silva', phone: '11988887777' });
    expect((db2.prepare('SELECT street FROM customer_addresses ORDER BY id').all() as any[]).map((a) => a.street)).toEqual(['Rua A, 1', 'Rua B, 2']);
    expect((db2.prepare('SELECT COUNT(*) n FROM orders WHERE customer_id IS NOT NULL').get() as any).n).toBe(3);
    db2.close();
    expect((openDb(file).prepare('SELECT COUNT(*) n FROM customers').get() as any).n).toBe(1); // não roda de novo
  });
});
