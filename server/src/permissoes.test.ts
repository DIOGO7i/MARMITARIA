// Divisão do sistema: o financeiro (caixa, compras, despesas, relatórios, custos) é só da responsável.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb } from './db';
import { createApp } from './app';
import { localNow } from './money';

const D = localNow('America/Sao_Paulo').date;
let server: Server; let base: string; let gisa: string; let func: string; let funcId: number;
const call = async (t: string, method: string, path: string, body?: any) => {
  const r = await fetch(base + '/api' + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const login = async (email: string, password: string) => {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return { status: r.status, body: await r.json() as any };
};

beforeAll(async () => {
  server = createApp(openDb(':memory:'), 'segredo', { mailer: null, route: null, places: null }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const s = await fetch(base + '/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Gisa', email: 'gisa@x.com', password: 'feijoada7' }) });
  gisa = ((await s.json()) as any).token;
  const u = await call(gisa, 'POST', '/users', { name: 'Ana Souza', email: 'ana@x.com', password: 'cozinha24' });
  expect(u.status).toBe(201); funcId = u.body.id;
  func = (await login('ana@x.com', 'cozinha24')).body.token;
}, 30000);
afterAll(() => server.close());

describe('funcionário', () => {
  it('não acessa nada do financeiro', async () => {
    const blocked: [string, string, any?][] = [
      ['GET', `/cash/${D}`], ['POST', `/cash/${D}/open`, { openingCents: 0 }],
      ['GET', '/purchases'], ['POST', '/purchases/parse-xml', { xml: '<x/>' }],
      ['GET', '/expenses'], ['POST', '/expenses', {}], ['GET', '/suppliers'],
      ['GET', `/reports/summary?from=${D}&to=${D}`], ['GET', '/reports/monthly?year=2026&month=10'], ['GET', `/reports/stock?from=${D}&to=${D}`],
      ['GET', '/reports/payables'], ['GET', '/users'], ['POST', '/users', {}], ['PUT', '/settings', {}], ['GET', '/stock/verify'],
    ];
    for (const [m, p, b] of blocked) {
      const r = await call(func, m, p, b);
      expect(r.status, `${m} ${p}`).toBe(403);
    }
  });

  it('faz o dia a dia: pedido com total, marca pago, cardápio, clientes, estoque (sem custos)', async () => {
    const o = await call(func, 'POST', '/orders', { idempotencyKey: 'p1', orderDate: D, orderTime: '12:00', source: 'presencial', deliveryType: 'retirada', items: [{ size: '450 g', qty: 2, unitPriceCents: 1400 }], deliveryFeeCents: 0, deliveryCostCents: 0, discountCents: 0, paymentStatus: 'pendente' });
    expect(o.status).toBe(201);
    expect(o.body.totalCents).toBe(2800);
    expect((await call(func, 'POST', `/orders/${o.body.id}/payments`, { amountCents: 2800, method: 'Pix' })).body.paymentStatus).toBe('pago');
    expect((await call(func, 'GET', `/menu/${D}`)).status).toBe(200);

    // estoque: Gisa cadastra com custo, funcionário vê a quantidade mas não o custo
    const p = await call(gisa, 'POST', '/products', { name: 'Arroz', unit: 'kg', qtyMilli: 10000, minQtyMilli: 2000, unitCostCents: 520, active: true });
    const lf = await call(func, 'GET', '/products');
    expect(lf.body[0].qtyMilli).toBe(10000);
    expect(lf.body[0]).not.toHaveProperty('unitCostCents');
    expect(lf.body[0]).not.toHaveProperty('valueCents');
    // editar o item não apaga o custo que a Gisa colocou
    await call(func, 'PUT', `/products/${p.body.id}`, { name: 'Arroz tipo 1', unit: 'kg', minQtyMilli: 3000, unitCostCents: 0, active: true });
    expect((await call(gisa, 'GET', `/products/${p.body.id}`)).body.unitCostCents).toBe(520);
    // "usei" funciona; movimentos sem custo
    expect((await call(func, 'POST', '/stock/out', { productId: p.body.id, qtyMilli: 1000, reason: 'consumo' })).status).toBe(201);
    const mv = await call(func, 'GET', `/stock/movements?productId=${p.body.id}`);
    expect(JSON.stringify(mv.body)).not.toMatch(/unit_?[cC]ost/);
  });

  it('a tela Hoje do funcionário vem sem nenhum valor em dinheiro', async () => {
    const d = await call(func, 'GET', `/reports/dashboard?from=${D}&to=${D}`);
    expect(d.status).toBe(200);
    expect(d.body.staff).toBe(true);
    expect(d.body.summary.orders.registered).toBeGreaterThan(0);
    expect(JSON.stringify(d.body)).not.toMatch(/Cents/);
    const g = await call(gisa, 'GET', `/reports/dashboard?from=${D}&to=${D}`);
    expect(g.body.summary.salesCents).toBe(2800);
  });

  it('cliente: funcionário não vê quanto o cliente já gastou', async () => {
    await call(gisa, 'POST', '/customers', { name: 'Maria', phone: '16999887766' });
    const l = await call(func, 'GET', '/customers');
    expect(JSON.stringify(l.body)).not.toMatch(/totalSpent/);
    expect(JSON.stringify((await call(gisa, 'GET', '/customers')).body)).toMatch(/totalSpent/);
  });
});

describe('equipe (Gisa)', () => {
  it('desativar o funcionário derruba o acesso na hora', async () => {
    expect((await call(gisa, 'PUT', `/users/${funcId}`, { active: false })).body.active).toBe(false);
    expect((await call(func, 'GET', '/me')).status).toBe(401);
    expect((await login('ana@x.com', 'cozinha24')).status).toBe(403);
    await call(gisa, 'PUT', `/users/${funcId}`, { active: true, password: 'panela88' });
    expect((await login('ana@x.com', 'cozinha24')).status).toBe(401);
    expect((await login('ana@x.com', 'panela88')).status).toBe(200);
  }, 30000);

  it('a Gisa não consegue se trancar para fora', async () => {
    const me = (await call(gisa, 'GET', '/me')).body.id;
    expect((await call(gisa, 'PUT', `/users/${me}`, { active: false })).status).toBe(400);
    expect((await call(gisa, 'PUT', `/users/${me}`, { role: 'staff' })).status).toBe(400);
    expect((await call(gisa, 'POST', '/users', { name: 'Ana 2', email: 'ana@x.com', password: 'cozinha24' })).status).toBe(400);
    expect((await call(gisa, 'POST', '/users', { name: 'Zé', email: 'ze@x.com', password: '123456' })).status).toBe(400);
  });
});
