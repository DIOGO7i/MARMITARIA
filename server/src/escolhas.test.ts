// v31: cardápio por botões — carnes e guarnições do dia; cada opção leva X carnes e Y guarnições (além do arroz e feijão).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, DEFAULT_SETTINGS } from './db';
import { createApp } from './app';

const PICK = new URL('../../web/src/components/ChoicePicker.tsx', import.meta.url).pathname;
const LINES = new URL('../../web/src/lib/choices.ts', import.meta.url).pathname;

let server: Server; let base: string; let t: string; let ana: string;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const j = (m: string, u: string, b?: any, tok = t) => fetch(base + u, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() as any }));
const order = (key: string, items: any[], tok = t) => j('POST', '/orders', { idempotencyKey: key, orderDate: today, orderTime: '11:30', source: 'whatsapp', customerName: 'Ana', deliveryType: 'retirada', items, deliveryFeeCents: 0, deliveryCostCents: 0, discountCents: 0, paymentMethod: 'Pix', paymentStatus: 'pago' }, tok);
const item = (option: string, size: string, carnes: string[], guarnicoes: string[]) => ({ option, size, qty: 1, unitPriceCents: 1200, notes: '', choices: { carnes, guarnicoes } });
const OPTS = [{ name: 'Opção 1', sizes: ['350 g', '450 g'] }, { name: 'Opção 2', sizes: ['650 g', '750 g'] }];
const ITEMS = { carnes: ['Frango empanado', 'Bisteca', { name: 'Almôndegas', soldOut: true }], guarnicoes: ['Purê', 'Farofa', 'Creme de milho'] };

beforeAll(async () => {
  server = createApp(openDb(':memory:'), 'segredo', { mailer: null, route: null, places: null }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  t = (await j('POST', '/auth/setup', { name: 'Gisa', email: 'gisa@x.com', password: 'feijoada7' })).body.token;
  await j('POST', '/users', { name: 'Ana', email: 'ana@x.com', password: 'cozinha24' });
  ana = (await j('POST', '/auth/login', { email: 'ana@x.com', password: 'cozinha24' }, '')).body.token;
});
afterAll(() => server.close());

describe('regras de cada opção', () => {
  it('Opção 1 = 1 carne + 1 guarnição; Opção 2 = 1 carne + 2 guarnições; arroz e feijão sempre', () => {
    expect(DEFAULT_SETTINGS.marmitaBase).toBe('Arroz e feijão');
    expect(DEFAULT_SETTINGS.menuOptions.map((o) => [o.name, o.carnes, o.guarnicoes])).toEqual([['Opção 1', 1, 1], ['Opção 2', 1, 2]]);
  });
  it('cardápio do dia guarda carnes e guarnições (repetidas e vazias saem), e as regras vêm do modelo', async () => {
    const r = await j('PUT', `/menu/${today}`, { options: OPTS, swaps: [], items: { ...ITEMS, guarnicoes: [...ITEMS.guarnicoes, ' purê ', ''] } });
    expect(r.status).toBe(200);
    expect(r.body.items.carnes).toEqual([{ name: 'Frango empanado', soldOut: false }, { name: 'Bisteca', soldOut: false }, { name: 'Almôndegas', soldOut: true }]);
    expect(r.body.items.guarnicoes.map((x: any) => x.name)).toEqual(['Purê', 'Farofa', 'Creme de milho']);
    expect(r.body.options.map((o: any) => [o.carnes, o.guarnicoes])).toEqual([[1, 1], [1, 2]]);
  });
  it('funcionária também pode montar o cardápio e marcar esgotou', async () => {
    const r = await j('PUT', `/menu/${today}`, { options: OPTS, items: ITEMS }, ana);
    expect(r.status).toBe(200);
  });
});

describe('pedido montado por botões', () => {
  it('Opção 2 com 2x Purê: grava as escolhas e a descrição com arroz e feijão', async () => {
    const r = await order('a1', [item('Opção 2', '650 g', ['Bisteca'], ['Purê', 'Purê'])]);
    expect(r.status).toBe(201);
    const o = (await j('GET', `/orders/${r.body.id}`)).body;
    expect(o.items[0].choices).toEqual({ carnes: ['Bisteca'], guarnicoes: ['Purê', 'Purê'] });
    expect(o.items[0].optionDescription).toBe('Arroz e feijão, Bisteca, 2x Purê');
  });
  it('não deixa passar do limite da opção', async () => {
    const a = await order('a2', [item('Opção 1', '350 g', ['Bisteca'], ['Purê', 'Farofa'])]);
    expect(a.status).toBe(400); expect(a.body.error).toBe('A Opção 1 leva só 1 guarnição.');
    const b = await order('a3', [item('Opção 2', '650 g', ['Bisteca', 'Frango empanado'], ['Purê'])]);
    expect(b.status).toBe(400); expect(b.body.error).toBe('A Opção 2 leva só 1 carne.');
  });
  it('pode escolher menos que o limite (cliente sem guarnição)', async () => {
    const r = await order('a4', [item('Opção 2', '650 g', ['Frango empanado'], [])]);
    expect(r.status).toBe(201);
  });
  it('recusa o que esgotou ou não está no cardápio do dia', async () => {
    const a = await order('a5', [item('Opção 1', '350 g', ['Almôndegas'], ['Purê'])]);
    expect(a.status).toBe(400); expect(a.body.error).toMatch(/Almôndegas” esgotou/);
    const b = await order('a6', [item('Opção 1', '350 g', ['Picanha'], ['Purê'])]);
    expect(b.status).toBe(400); expect(b.body.error).toMatch(/Picanha” não está nas carnes/);
  });
  it('editar pedido: o que já tinha continua valendo mesmo se esgotou depois', async () => {
    const r = await order('a7', [item('Opção 1', '350 g', ['Frango empanado'], ['Farofa'])]);
    await j('PUT', `/menu/${today}`, { options: OPTS, items: { carnes: [{ name: 'Frango empanado', soldOut: true }, 'Bisteca'], guarnicoes: ['Purê'] } });
    const o = (await j('GET', `/orders/${r.body.id}`)).body;
    const body = { ...o, idempotencyKey: undefined, items: o.items.map((i: any) => ({ option: i.option, size: i.size, qty: 2, unitPriceCents: i.unitPriceCents, notes: i.notes ?? '', choices: i.choices })) };
    const u = await j('PUT', `/orders/${o.id}`, body);
    expect(u.status).toBe(200);
    const novo = await j('PUT', `/orders/${o.id}`, { ...body, items: [item('Opção 1', '350 g', ['Frango empanado'], ['Creme de milho'])] });
    expect(novo.status).toBe(400); // Creme de milho saiu do cardápio e não era do pedido
  });
  it('pedido sem escolhas (cardápio antigo) continua funcionando', async () => {
    const r = await order('a8', [{ option: 'Opção 1', size: '350 g', qty: 1, unitPriceCents: 1200, notes: 'sem salada' }]);
    expect(r.status).toBe(201);
    expect((await j('GET', `/orders/${r.body.id}`)).body.items[0].choices).toBeNull();
  });
});

describe('botões no pedido (como reagem ao toque)', () => {
  it('carne (limite 1): escolhe, troca e desmarca', async () => {
    const { pick } = await import(PICK);
    expect(pick([], 'Bisteca', 1, false)).toEqual(['Bisteca']);
    expect(pick(['Bisteca'], 'Frango', 1, false)).toEqual(['Frango']);
    expect(pick(['Frango'], 'Frango', 1, false)).toEqual([]);
  });
  it('guarnições (limite 2): repete, troca a última quando cheio, tira tocando na escolhida', async () => {
    const { pick } = await import(PICK);
    let l = pick([], 'Purê', 2, true); l = pick(l, 'Purê', 2, true);
    expect(l).toEqual(['Purê', 'Purê']);
    expect(pick(l, 'Farofa', 2, true)).toEqual(['Purê', 'Farofa']);
    expect(pick(['Purê', 'Farofa'], 'Purê', 2, true)).toEqual(['Farofa']);
  });
  it('linhas da comanda', async () => {
    const { choiceLines } = await import(LINES);
    expect(choiceLines({ carnes: ['Bisteca'], guarnicoes: ['Purê', 'Purê'] })).toEqual(['Carne: Bisteca', 'Guarnições: 2x Purê']);
    expect(choiceLines({ carnes: ['Bisteca'], guarnicoes: [] })).toEqual(['Carne: Bisteca']);
  });
});

describe('atualização de quem já usa', () => {
  it('modelo antigo sem quantidades ganha a regra da Gisa', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'v31-')), 'm.db');
    let db = openDb(f);
    db.prepare("UPDATE settings SET value = ? WHERE key = 'menuOptions'").run(JSON.stringify([{ name: 'Opção 1', description: '', sizes: ['350 g'] }, { name: 'Opção 2', description: '', sizes: ['650 g'] }]));
    db.close(); db = openDb(f);
    const l = JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'menuOptions'").get() as any).value);
    expect(l.map((o: any) => [o.carnes, o.guarnicoes])).toEqual([[1, 1], [1, 2]]);
    db.close();
  });
});
