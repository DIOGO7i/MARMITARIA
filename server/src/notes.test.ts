// Cardápio montado por partes (v30) e botões de troca em cada marmita do pedido.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { partSwapText, partSwapTexts, stripSwaps, toggleNote, hasNote, splitNotes } from '../../web/src/lib/notes';
import { openDb, DEFAULT_SETTINGS } from './db';
import { createApp } from './app';

// whatsapp.ts usa tipos do React do site; carregado sem checagem de tipos do servidor
const WA = new URL('../../web/src/lib/whatsapp.ts', import.meta.url).pathname;
const { menuText, swapLine } = await import(WA);

const carne = { label: 'Carne', value: 'Frango empanado', swaps: ['Almôndegas', 'Omelete'] };
const guarn = { label: 'Guarnição', value: 'Creme de milho', swaps: ['Purê'] };

describe('texto das trocas', () => {
  it('troca de uma parte vira frase clara para a cozinha', () => {
    expect(partSwapText('Frango empanado', 'Almôndegas')).toBe('Trocar frango empanado por Almôndegas');
    expect(partSwapTexts(carne)).toEqual(['Trocar frango empanado por Almôndegas', 'Trocar frango empanado por Omelete']);
  });
  it('linha do WhatsApp', () => {
    expect(swapLine(carne)).toBe('Carne: pode trocar por Almôndegas ou Omelete');
    expect(swapLine({ label: '', value: 'Purê', swaps: ['Farofa'] })).toBe('Purê: pode trocar por Farofa');
  });
});

describe('ligar e desligar trocas', () => {
  const all = partSwapTexts(carne);
  it('só uma troca por parte; escolher outra substitui; o que foi digitado fica', () => {
    let n = toggleNote('bem passada', all[0], all);
    expect(n).toBe('bem passada; Trocar frango empanado por Almôndegas');
    n = toggleNote(n, all[1], all);
    expect(splitNotes(n)).toEqual(['bem passada', 'Trocar frango empanado por Omelete']);
    n = toggleNote(n, partSwapText(guarn.value, 'Purê'), partSwapTexts(guarn));
    expect(splitNotes(n)).toHaveLength(3);
  });
  it('trocar de opção tira só as trocas da opção antiga', () => {
    const n = 'Trocar frango empanado por Omelete; sem pimenta; Trocar creme de milho por Purê';
    expect(stripSwaps(n, [carne, guarn])).toBe('sem pimenta');
    expect(hasNote(n, 'SEM PIMENTA')).toBe(true);
  });
});

describe('cardápio por partes no servidor', () => {
  let server: Server; let base: string; let t: string; const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const j = (m: string, u: string, b?: any) => fetch(base + u, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() as any }));
  beforeAll(async () => {
    server = createApp(openDb(':memory:'), 'segredo', { mailer: null, route: null, places: null }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    t = (await j('POST', '/auth/setup', { name: 'Gisa', email: 'gisa@x.com', password: 'feijoada7' })).body.token;
  });
  afterAll(() => server.close());

  it('salva as partes e monta a descrição sozinho', async () => {
    const r = await j('PUT', `/menu/${today}`, { options: [{ name: 'Opção 1', sizes: ['350 g'], parts: [
      { label: 'Acompanhamento', value: 'Arroz e feijão', swaps: [] }, { ...carne, swaps: [' Almôndegas ', 'Omelete', 'almôndegas', 'Frango empanado'] }, guarn,
      { label: 'Salada', value: '', swaps: [] },
    ] }], swaps: [] });
    expect(r.status).toBe(200);
    const o = r.body.options[0];
    expect(o.description).toBe('Arroz e feijão, Frango empanado, Creme de milho');
    expect(o.parts).toEqual([{ label: 'Acompanhamento', value: 'Arroz e feijão', swaps: [] }, carne, guarn]); // repetidas e vazias saem
  });
  it('pedido grava a descrição e a troca na observação', async () => {
    const r = await j('POST', '/orders', { idempotencyKey: 'p1', orderDate: today, orderTime: '11:30', source: 'whatsapp', customerName: 'Ana', deliveryType: 'retirada', items: [{ option: 'Opção 1', size: '350 g', qty: 1, unitPriceCents: 1200, notes: 'Trocar frango empanado por Omelete' }], deliveryFeeCents: 0, deliveryCostCents: 0, discountCents: 0, paymentMethod: 'Pix', paymentStatus: 'pago' });
    expect(r.status).toBe(201);
    const o = (await j('GET', `/orders/${r.body.id}`)).body;
    expect(o.items[0].optionDescription).toBe('Arroz e feijão, Frango empanado, Creme de milho');
    expect(o.items[0].notes).toBe('Trocar frango empanado por Omelete');
  });
  it('recusa troca sem dizer o que vai na parte, e partes demais', async () => {
    const a = await j('PUT', `/menu/${today}`, { options: [{ name: 'Opção 1', parts: [{ label: 'Carne', value: '', swaps: ['Omelete'] }] }] });
    expect(a.status).toBe(400); expect(a.body.error).toMatch(/diga o que vai em “Carne”/);
    const b = await j('PUT', `/menu/${today}`, { options: [{ name: 'Opção 1', parts: Array.from({ length: 9 }, (_, i) => ({ label: `P${i}`, value: `x${i}`, swaps: [] })) }] });
    expect(b.status).toBe(400);
  });
  it('opção antiga, só com descrição, continua funcionando', async () => {
    const r = await j('PUT', `/menu/${today}`, { options: [{ name: 'Opção 1', description: 'Feijoada completa' }] });
    expect(r.status).toBe(200); expect(r.body.options[0].description).toBe('Feijoada completa'); expect(r.body.options[0].parts).toBeUndefined();
  });
});

describe('texto do WhatsApp mostra as trocas', () => {
  it('uma linha por parte que troca', () => {
    const s = { ...DEFAULT_SETTINGS, modules: {} } as any;
    const txt = menuText([{ name: 'Opção 1', description: 'Arroz e feijão, Frango empanado, Creme de milho', sizes: [], parts: [{ label: 'Acompanhamento', value: 'Arroz e feijão', swaps: [] }, carne, guarn] }], s, '2026-10-20', '2026-10-20');
    expect(txt).toContain('↪ Carne: pode trocar por Almôndegas ou Omelete');
    expect(txt).toContain('↪ Guarnição: pode trocar por Purê');
    expect(txt).not.toContain('Acompanhamento: pode');
  });
});

describe('observações rápidas', () => {
  it('vêm vazias (só as trocas aparecem) e a lista da v29 é limpa ao atualizar', () => {
    expect(DEFAULT_SETTINGS.quickNotes).toEqual([]);
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qn-')), 'm.db');
    let db = openDb(f);
    db.prepare("UPDATE settings SET value = ? WHERE key = 'quickNotes'").run(JSON.stringify(['Sem salada', 'Sem cebola', 'Sem feijão', 'Pouco arroz', 'Mais arroz', 'Molho à parte']));
    db.close(); db = openDb(f);
    expect(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'quickNotes'").get() as any).value)).toEqual([]);
    db.prepare("UPDATE settings SET value = ? WHERE key = 'quickNotes'").run(JSON.stringify(['Sem cebola']));
    db.close(); db = openDb(f);
    expect(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'quickNotes'").get() as any).value)).toEqual(['Sem cebola']); // mexida pela Gisa: fica
    db.close();
  });
});
