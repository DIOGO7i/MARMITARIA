// Testes da auditoria: cada um reproduz um defeito encontrado na revisão (devem falhar antes da correção).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import { openDb } from './db';
import { createApp } from './app';
import { reqDate } from './services/common';
import { createProduct, getProduct } from './services/inventory';
import { createPurchase, cancelPurchase } from './services/purchases';
import { createOrder, setOrderStatus, updateOrder, getOrder, addOrderPayment } from './services/orders';
import { createExpense, voidExpense } from './services/expenses';
import { saveRecipe } from './services/recipes';
import { summary } from './services/reports';
import { cashDay, openCash } from './services/cash';
import { parseNfeXml } from './nfe';
import { localNow } from './money';
import type { Ctx } from './services/common';

const today = () => localNow('America/Sao_Paulo').date;

describe('datas', () => {
  it('recusa datas que não existem no calendário', () => {
    expect(() => reqDate('2026-02-30')).toThrow(/inválida/);
    expect(() => reqDate('2026-04-31')).toThrow(/inválida/);
    expect(() => reqDate('2026-13-01')).toThrow(/inválida/);
    expect(reqDate('2024-02-29')).toBe('2024-02-29');
    expect(reqDate('2026-12-31')).toBe('2026-12-31');
  });
});

describe('serviços', () => {
  let ctx: Ctx;
  beforeEach(() => { ctx = { db: openDb(':memory:'), userId: null, role: 'owner' }; });
  const order = (over: any = {}) => createOrder(ctx, { orderDate: today(), orderTime: '12:00', source: 'presencial', deliveryType: 'retirada',
    items: [{ size: '450 g', qty: 1, unitPriceCents: 2200 }], deliveryFeeCents: 0, deliveryCostCents: 0, discountCents: 0, paymentStatus: 'pendente', ...over });

  it('cancelar uma compra digitada errado devolve o custo médio do produto', () => {
    const p = createProduct(ctx, { name: 'Arroz', unit: 'kg', minQtyMilli: 0, unitCostCents: 0, active: true });
    createPurchase(ctx, { idempotencyKey: 'c1', purchaseDate: today(), items: [{ productId: p.id, qtyMilli: 10000, totalCents: 6000 }], discountCents: 0, freightCents: 0, paymentStatus: 'pago' });
    expect(getProduct(ctx, p.id).unitCostCents).toBe(600);
    // erro de digitação: 10 kg por R$ 600,00
    const errada = createPurchase(ctx, { idempotencyKey: 'c2', purchaseDate: today(), items: [{ productId: p.id, qtyMilli: 10000, totalCents: 60000 }], discountCents: 0, freightCents: 0, paymentStatus: 'pago' });
    expect(getProduct(ctx, p.id).unitCostCents).toBe(3300);
    cancelPurchase(ctx, errada.id, 'digitei errado');
    expect(getProduct(ctx, p.id).unitCostCents).toBe(600);
  });

  it('cancelar a única compra de um produto volta o custo ao valor anterior', () => {
    const p = createProduct(ctx, { name: 'Feijão', unit: 'kg', minQtyMilli: 0, unitCostCents: 850, active: true });
    const c = createPurchase(ctx, { idempotencyKey: 'c3', purchaseDate: today(), items: [{ productId: p.id, qtyMilli: 5000, totalCents: 99999 }], discountCents: 0, freightCents: 0, paymentStatus: 'pago' });
    cancelPurchase(ctx, c.id, 'erro');
    expect(getProduct(ctx, p.id).unitCostCents).toBe(850);
  });

  it('estornos usam a mesma forma de pagamento: dinheiro devolvido sai do caixa', () => {
    const d = today();
    openCash(ctx, d, 10000);
    const o = order({ paymentStatus: 'pago', paymentMethod: 'Dinheiro' });
    expect(cashDay(ctx, d).expectedCashCents).toBe(12200);
    setOrderStatus(ctx, o.id, 'cancelado', { reason: 'cliente desistiu e pegou o dinheiro' });
    expect(cashDay(ctx, d).expectedCashCents).toBe(10000);
    const e = createExpense(ctx, { description: 'Gás', category: 'Gás', expenseDate: d, amountCents: 3000, status: 'pago', paymentMethod: 'Dinheiro' });
    expect(cashDay(ctx, d).expectedCashCents).toBe(7000);
    voidExpense(ctx, e.id, 'lançada errada');
    expect(cashDay(ctx, d).expectedCashCents).toBe(10000);
  });

  it('pagamentos de formas diferentes são estornados cada um na sua forma', () => {
    const o = order({ items: [{ size: '450 g', qty: 2, unitPriceCents: 2200 }] });
    addOrderPayment(ctx, o.id, { amountCents: 1000, method: 'Dinheiro' });
    addOrderPayment(ctx, o.id, { amountCents: 3400, method: 'Pix' });
    const c = setOrderStatus(ctx, o.id, 'cancelado', { reason: 'x' });
    const neg = c.payments.filter((p: any) => p.amountCents < 0).map((p: any) => `${p.method}:${p.amountCents}`).sort();
    expect(neg).toEqual(['Dinheiro:-1000', 'Pix:-3400']);
  });

  it('custo dos insumos no resultado não conta duas vezes ao editar ou cancelar pedido já baixado', () => {
    const p = createProduct(ctx, { name: 'Arroz', unit: 'kg', qtyMilli: 10000, minQtyMilli: 0, unitCostCents: 600, active: true });
    saveRecipe(ctx, '450 g', [{ productId: p.id, qtyMilli: 100 }]); // 60 centavos por marmita
    const o = order({ status: 'entregue' });
    expect(summary(ctx, today(), today()).consumptionCostCents).toBe(60);
    const full = getOrder(ctx, o.id) as any;
    updateOrder(ctx, o.id, { ...full, notes: 'editado', deliveredAt: null });
    expect(summary(ctx, today(), today()).consumptionCostCents).toBe(60);
    setOrderStatus(ctx, o.id, 'cancelado', { reason: 'x' });
    expect(summary(ctx, today(), today()).consumptionCostCents).toBe(0);
  });

  it('funcionário não informa horário real de entrega manual ao criar o pedido', () => {
    const staff: Ctx = { ...ctx, role: 'staff' };
    expect(() => createOrder(staff, { orderDate: today(), orderTime: '12:00', source: 'presencial', deliveryType: 'retirada',
      items: [{ size: '450 g', qty: 1, unitPriceCents: 2200 }], deliveryFeeCents: 0, deliveryCostCents: 0, discountCents: 0,
      paymentStatus: 'pendente', status: 'entregue', deliveredAt: '2026-01-01T10:00' })).toThrow(/responsável/);
  });

  it('XML com DOCTYPE/ENTITY é recusado (proteção contra arquivo malicioso)', () => {
    const bomb = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><nfeProc><NFe><infNFe Id="NFe1"><det><prod><xProd>&b;</xProd></prod></det></infNFe></NFe></nfeProc>';
    expect(() => parseNfeXml(bomb)).toThrow(/não é permitido|inválido/i);
  });
});

describe('API', () => {
  let server: Server; let base: string; let owner = ''; let staff = '';
  const call = async (method: string, url: string, body?: unknown, token = owner, raw?: string) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
    return { status: r.status, body: await r.json().catch(() => null) as any, headers: r.headers };
  };
  beforeAll(async () => {
    const db = openDb(':memory:');
    server = createApp(db, 'segredo').listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    owner = (await call('POST', '/api/auth/setup', { name: 'Dona', email: 'dona@x.com', password: 'senha-forte-1' }, '')).body.token;
    db.prepare("INSERT INTO users(email, name, password_hash, role) VALUES ('func@x.com','Func',?,'staff')").run(bcrypt.hashSync('senha-func-1', 4));
    staff = (await call('POST', '/api/auth/login', { email: 'func@x.com', password: 'senha-func-1' }, '')).body.token;
  });
  afterAll(() => { server.close(); });

  it('funcionário não estorna recebimento pela API', async () => {
    const o = await call('POST', '/api/orders', { orderDate: today(), orderTime: '12:00', source: 'presencial', deliveryType: 'retirada',
      items: [{ size: '450 g', qty: 1, unitPriceCents: 2200 }], deliveryFeeCents: 0, deliveryCostCents: 0, discountCents: 0, paymentStatus: 'pago', paymentMethod: 'Pix' });
    const pid = o.body.id;
    const det = await call('GET', `/api/orders/${pid}`);
    const r = await call('POST', `/api/orders/${pid}/payments/${det.body.payments[0].id}/reverse`, {}, staff);
    expect(r.status).toBe(403);
  });

  it('parâmetros inválidos dão erro claro, não erro interno', async () => {
    expect((await call('GET', '/api/orders?page=abc&pageSize=xyz')).status).toBe(200);
    expect((await call('GET', '/api/orders/abc')).status).toBe(404);
    expect((await call('GET', '/api/reports/payables?days=abc')).status).toBe(400);
    expect((await call('GET', '/api/customers?page=abc')).status).toBe(200);
  });

  it('JSON malformado e corpo grande demais respondem em português', async () => {
    const bad = await call('POST', '/api/orders', undefined, owner, '{"orderDate": ');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/dados enviados/i);
    const big = await call('POST', '/api/expenses', undefined, owner, JSON.stringify({ description: 'x'.repeat(2_000_000) }));
    expect(big.status).toBe(413);
    expect(big.body.error).toMatch(/grande/i);
  });

  it('respostas trazem cabeçalhos básicos de segurança', async () => {
    const r = await fetch(base + '/api/health');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(r.headers.get('referrer-policy')).toBe('same-origin');
  });

  it('nenhuma rota de dados responde sem login', async () => {
    const routes = ['/api/orders', '/api/products', '/api/purchases', '/api/expenses', '/api/customers', '/api/settings', '/api/recipes',
      `/api/cash/${today()}`, '/api/reports/payables', `/api/reports/summary?from=${today()}&to=${today()}`, '/api/stock/movements', '/api/suppliers', '/api/me'];
    for (const r of routes) expect((await call('GET', r, undefined, '')).status, r).toBe(401);
    expect((await call('GET', '/api/orders', undefined, 'token.falso.aqui')).status).toBe(401);
  });
});

describe('cardápio da Gisa', () => {
  it('instalação nova já vem com os 4 tamanhos por peso e o nome', async () => {
    const { getSettings } = await import('./db');
    const s = getSettings(openDb(':memory:'));
    expect(s.sizes).toEqual([{ name: '350 g', priceCents: 1200 }, { name: '450 g', priceCents: 1400 }, { name: '650 g', priceCents: 1600 }, { name: '750 g', priceCents: 1800 }]);
    expect(s.establishment).toMatchObject({ name: 'Gisa Agustoni Gastronomia', address: 'R. João Penteado, 2220 - Jardim América, Ribeirão Preto - SP, 14020-180', city: 'Ribeirão Preto - SP' });
  });
  it('instalação antiga: troca só o que ainda era exemplo, uma vez; o que a pessoa mudou fica', async () => {
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    const { getSettings } = await import('./db');
    const mk = (sizes: unknown, name: string) => {
      const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-')), 'x.db');
      const db = openDb(f);
      db.prepare("UPDATE settings SET value = ? WHERE key = 'sizes'").run(JSON.stringify(sizes));
      db.prepare("UPDATE settings SET value = ? WHERE key = 'establishment'").run(JSON.stringify({ name, phone: '', address: 'Rua X', hours: '', reportHeader: '' }));
      db.prepare("DELETE FROM settings WHERE key = 'migr_cardapio_gisa'").run();
      db.close();
      return getSettings(openDb(f));
    };
    const old = mk([{ name: 'Pequena', priceCents: 1800 }, { name: 'Média', priceCents: 2200 }, { name: 'Grande', priceCents: 2600 }], 'Minha Marmitaria');
    expect(old.sizes.map((x) => x.name)).toEqual(['350 g', '450 g', '650 g', '750 g']);
    expect(old.establishment).toMatchObject({ name: 'Gisa Agustoni Gastronomia', address: 'Rua X', phone: '(16) 99151-5757 / (16) 99390-7272' });
    const custom = mk([{ name: 'Média', priceCents: 2500 }], 'Restaurante da Rua');
    expect(custom.sizes).toEqual([{ name: 'Média', priceCents: 2500 }]);
    expect(custom.establishment.name).toBe('Restaurante da Rua');
  });
  it('v15: quem estava com o nome curto e sem endereço recebe o nome completo e o endereço; o que foi mudado fica', async () => {
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    const { getSettings } = await import('./db');
    const mk = (est: any) => {
      const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-')), 'x.db');
      const db = openDb(f);
      db.prepare("UPDATE settings SET value = ? WHERE key = 'establishment'").run(JSON.stringify(est));
      db.prepare("DELETE FROM settings WHERE key = 'migr_endereco_gisa'").run();
      db.close();
      return getSettings(openDb(f)).establishment;
    };
    expect(mk({ name: 'Gisa Gastronomia', phone: '1', address: '', hours: '', reportHeader: 'Gisa Gastronomia — O sabor de casa, todos os dias' }))
      .toMatchObject({ name: 'Gisa Agustoni Gastronomia', phone: '1', address: expect.stringMatching(/João Penteado, 2220/), city: 'Ribeirão Preto - SP', reportHeader: expect.stringMatching(/Agustoni/) });
    expect(mk({ name: 'Outro Nome', phone: '', address: 'Rua Y, 10', hours: '', reportHeader: 'Meu cabeçalho' }))
      .toMatchObject({ name: 'Outro Nome', address: 'Rua Y, 10', reportHeader: 'Meu cabeçalho' });
  });
});

describe('opções do cardápio', () => {
  it('cada marmita guarda a opção; relatório conta por opção e tamanho; histórico do cliente mostra', async () => {
    const { createCustomer, getCustomer } = await import('./services/customers');
    const { getSettings } = await import('./db');
    const ctx: Ctx = { db: openDb(':memory:'), userId: null, role: 'owner' };
    expect(getSettings(ctx.db).menuOptions.map((o) => [o.name, o.sizes])).toEqual([['Opção 1', ['350 g', '450 g']], ['Opção 2', ['650 g', '750 g']]]);
    const c = createCustomer(ctx, { name: 'Lia', phone: '16991515757' });
    const o = createOrder(ctx, { orderDate: today(), orderTime: '12:00', source: 'whatsapp', deliveryType: 'retirada', customerId: c.id,
      items: [{ size: '350 g', qty: 2, unitPriceCents: 1200, option: 'Opção 1' }, { size: '750 g', qty: 1, unitPriceCents: 1800, option: 'Opção 2', notes: 'trocar por linguiça' }],
      deliveryFeeCents: 0, deliveryCostCents: 0, discountCents: 0, paymentStatus: 'pendente' });
    expect(o.items.map((i: any) => [i.option, i.size, i.qty])).toEqual([['Opção 1', '350 g', 2], ['Opção 2', '750 g', 1]]);
    expect(o.totalCents).toBe(4200);
    const s = summary(ctx, today(), today());
    expect(s.marmitasTotal).toBe(3);
    expect(s.marmitasByOption).toEqual([
      { option: 'Opção 1', qty: 2, sizes: [{ size: '350 g', qty: 2 }] },
      { option: 'Opção 2', qty: 1, sizes: [{ size: '750 g', qty: 1 }] },
    ]);
    expect((getCustomer(ctx, c.id).orderHistory[0] as any).itemsText).toBe('2x 350 g (Opção 1), 1x 750 g (Opção 2)');
    // editar mantém e permite trocar a opção
    const full = getOrder(ctx, o.id) as any;
    const ed = updateOrder(ctx, o.id, { ...full, deliveredAt: null, items: [{ size: '450 g', qty: 1, unitPriceCents: 1400, option: 'Opção 1' }] });
    expect(ed.items.map((i: any) => i.option)).toEqual(['Opção 1']);
    // cancelado não conta
    setOrderStatus(ctx, o.id, 'cancelado', { reason: 'x' });
    expect(summary(ctx, today(), today()).marmitasTotal).toBe(0);
  });
});
