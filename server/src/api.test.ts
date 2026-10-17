import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb } from './db';
import { createApp } from './app';

let server: Server; let base: string; let token = '';

const call = async (method: string, url: string, body?: unknown, auth = true) => {
  const r = await fetch(base + url, {
    method, headers: { 'content-type': 'application/json', ...(auth && token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() as any };
};

beforeAll(async () => {
  server = createApp(openDb(':memory:'), 'segredo-de-teste').listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

describe('API', () => {
  it('rotas privadas exigem login', async () => {
    expect((await call('GET', '/api/orders', undefined, false)).status).toBe(401);
    expect((await call('GET', '/api/settings', undefined, false)).status).toBe(401);
  });

  it('cria o primeiro usuário uma única vez e faz login', async () => {
    expect((await call('GET', '/api/auth/status')).body.needsSetup).toBe(true);
    const s = await call('POST', '/api/auth/setup', { name: 'Dona', email: 'dona@x.com', password: 'senha-forte-1' });
    expect(s.status).toBe(200);
    expect((await call('POST', '/api/auth/setup', { name: 'Outro', email: 'o@x.com', password: 'senha-forte-1' })).status).toBe(403);
    expect((await call('POST', '/api/auth/login', { email: 'dona@x.com', password: 'errada' })).status).toBe(401);
    const l = await call('POST', '/api/auth/login', { email: 'dona@x.com', password: 'senha-forte-1' });
    token = l.body.token;
    expect(token).toBeTruthy();
  });

  it('compra via API é idempotente e atualiza o estoque uma só vez', async () => {
    const p = await call('POST', '/api/products', { name: 'Arroz', unit: 'kg', minQtyMilli: 2000, unitCostCents: 0, active: true });
    expect(p.status).toBe(201);
    const payload = { idempotencyKey: 'chave-unica-123', purchaseDate: '2026-10-12', items: [{ productId: p.body.id, qtyMilli: 10000, totalCents: 6000 }], discountCents: 0, freightCents: 0, paymentStatus: 'pago' };
    const a = await call('POST', '/api/purchases', payload);
    const b = await call('POST', '/api/purchases', payload);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.duplicate).toBe(true);
    const prod = await call('GET', `/api/products/${p.body.id}`);
    expect(prod.body.qtyMilli).toBe(10000);
    expect(prod.body.unitCostCents).toBe(600);
    expect((await call('GET', '/api/stock/verify')).body.divergences).toEqual([]);
  });

  it('valida no servidor: quantidade inválida e total negativo', async () => {
    const base = { orderDate: '2026-10-12', orderTime: '12:00', source: 'presencial', deliveryType: 'retirada', deliveryFeeCents: 0, deliveryCostCents: 0, discountCents: 0, paymentStatus: 'pendente' };
    const r1 = await call('POST', '/api/orders', { ...base, items: [{ size: '450 g', qty: 0, unitPriceCents: 2200 }] });
    expect(r1.status).toBe(400);
    const r2 = await call('POST', '/api/orders', { ...base, discountCents: 100000, items: [{ size: '450 g', qty: 1, unitPriceCents: 2200 }] });
    expect(r2.status).toBe(400);
    expect(r2.body.error).toMatch(/negativo/);
    const ok = await call('POST', '/api/orders', { ...base, items: [{ size: '450 g', qty: 2, unitPriceCents: 2200 }] });
    expect(ok.status).toBe(201);
    expect(ok.body.totalCents).toBe(4400);
    expect(ok.body.number).toBe(1);
  });

  it('dashboard e relatório mensal respondem com dados reais', async () => {
    const d = await call('GET', '/api/reports/dashboard?from=2026-10-12&to=2026-10-12');
    expect(d.status).toBe(200);
    expect(d.body.summary.salesCents).toBe(4400);
    expect(d.body.summary.purchasesCents).toBe(6000);
    const m = await call('GET', '/api/reports/monthly?year=2026&month=10');
    expect(m.body.current.orders.registered).toBe(1);
    expect(m.body.previous).toBeNull();
    expect((await call('GET', '/api/reports/summary?from=2026-10-20&to=2026-10-01')).status).toBe(400);
  });

  it('clientes: exige login, busca por telefone, recusa duplicado com o id existente', async () => {
    expect((await call('GET', '/api/customers/by-phone/11988887777', undefined, false)).status).toBe(401);
    const novo = await call('POST', '/api/customers', { name: 'Maria', phone: '(11) 98888-7777', addresses: [{ label: 'Casa', street: 'Rua A, 1', neighborhood: 'Centro' }] });
    expect(novo.status).toBe(201);
    const dup = await call('POST', '/api/customers', { name: 'Outra', phone: '11 98888 7777' });
    expect(dup.status).toBe(409);
    expect(dup.body.existingId).toBe(novo.body.id);
    const f = await call('GET', '/api/customers/by-phone/' + encodeURIComponent('(11) 98888-7777'));
    expect(f.body.customer.addresses[0].street).toBe('Rua A, 1');
    const bad = await call('GET', '/api/customers/by-phone/12345');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/inválido/);
  });
});
