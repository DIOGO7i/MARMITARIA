// Apagar dados de teste: só pedidos/clientes, só a responsável, com confirmação; o resto fica.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb, type DB } from './db';
import { createApp } from './app';

let server: Server; let base: string; let t: string; let ana: string; let db: DB;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const j = (m: string, u: string, b?: any, tok = t) => fetch(base + u, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() as any }));
const order = (key: string, date = today, phone = '16999990000') => j('POST', '/orders', { idempotencyKey: key, orderDate: date, orderTime: '11:30', source: 'whatsapp', customerName: 'Teste', customerPhone: phone, saveCustomer: true, deliveryType: 'retirada', items: [{ size: '350 g', qty: 1, unitPriceCents: 1200 }], deliveryFeeCents: 0, deliveryCostCents: 0, discountCents: 0, paymentMethod: 'Pix', paymentStatus: 'pago' });
const n = (sql: string) => (db.prepare(sql).get() as any).n;

beforeAll(async () => {
  db = openDb(':memory:');
  server = createApp(db, 'segredo', { mailer: null, route: null, places: null }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  t = (await j('POST', '/auth/setup', { name: 'Gisa', email: 'gisa@x.com', password: 'feijoada7' })).body.token;
  await j('POST', '/users', { name: 'Ana', email: 'ana@x.com', password: 'cozinha24' });
  ana = (await j('POST', '/auth/login', { email: 'ana@x.com', password: 'cozinha24' }, '')).body.token;
  await order('o1'); await order('o2', today, '16999990001'); await order('o3', '2026-10-01', '16999990002');
  await j('POST', '/expenses', { description: 'Gás', category: 'Gás', expenseDate: today, amountCents: 13500, paymentMethod: 'Pix', status: 'pago' });
});
afterAll(() => server.close());

describe('apagar dados de teste', () => {
  it('funcionária não pode; sem digitar APAGAR não apaga', async () => {
    expect((await j('POST', '/limpar-testes', { confirm: 'APAGAR', pedidos: true, clientes: true, ate: today }, ana)).status).toBe(403);
    const r = await j('POST', '/limpar-testes', { confirm: 'apagar sim', pedidos: true, clientes: true, ate: today });
    expect(r.status).toBe(400); expect(r.body.error).toMatch(/Digite APAGAR/);
    expect(n('SELECT COUNT(*) n FROM orders')).toBe(3);
  });
  it('só pedidos até uma data: o pedido mais novo fica; clientes ficam', async () => {
    const r = await j('POST', '/limpar-testes', { confirm: 'APAGAR', pedidos: true, clientes: false, ate: '2026-10-05' });
    expect(r.status).toBe(200); expect(r.body).toEqual({ orders: 1, customers: 0 });
    expect(n('SELECT COUNT(*) n FROM orders')).toBe(2);
    expect(n('SELECT COUNT(*) n FROM customers')).toBe(3);
  });
  it('tudo: pedidos, recebimentos, comandas e clientes somem; despesa, equipe e configurações ficam', async () => {
    const r = await j('POST', '/limpar-testes', { confirm: 'APAGAR', pedidos: true, clientes: true, ate: today });
    expect(r.body).toEqual({ orders: 2, customers: 3 });
    expect(n('SELECT COUNT(*) n FROM orders') + n('SELECT COUNT(*) n FROM order_items') + n("SELECT COUNT(*) n FROM payments WHERE ref_type='pedido'") + n('SELECT COUNT(*) n FROM print_jobs')).toBe(0);
    expect(n('SELECT COUNT(*) n FROM customers') + n('SELECT COUNT(*) n FROM customer_addresses')).toBe(0);
    expect(n('SELECT COUNT(*) n FROM expenses')).toBe(1);
    expect(n("SELECT COUNT(*) n FROM payments WHERE ref_type='despesa'")).toBe(1);
    expect(n('SELECT COUNT(*) n FROM users')).toBe(2);
    expect(n("SELECT COUNT(*) n FROM settings WHERE key='sizes'")).toBe(1);
  });
  it('a numeração recomeça no #1', async () => {
    const r = await order('o4');
    expect(r.status).toBe(201); expect(r.body.number).toBe(1);
  });
});
