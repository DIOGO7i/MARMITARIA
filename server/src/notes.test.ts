// Botões de troca e observação rápida em cada marmita do pedido.
import { describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import { swapText, toggleNote, hasNote, splitNotes } from '../../web/src/lib/notes';
import { openDb, DEFAULT_SETTINGS } from './db';
import { createApp } from './app';

describe('texto das trocas', () => {
  it('"Para trocar a carne" + item vira frase', () => {
    expect(swapText('Para trocar a carne', 'Almôndegas')).toBe('Trocar a carne por Almôndegas');
    expect(swapText('Para trocar a guarnição:', 'Purê')).toBe('Trocar a guarnição por Purê');
    expect(swapText('Bebida', 'Suco')).toBe('Bebida por Suco');
  });
});

describe('ligar e desligar observações', () => {
  const carne = ['Trocar a carne por Almôndegas', 'Trocar a carne por Coxa assada'];
  it('liga, junta com o que já foi digitado e desliga', () => {
    let n = 'sem pimenta';
    n = toggleNote(n, 'Sem salada');
    expect(n).toBe('sem pimenta; Sem salada');
    n = toggleNote(n, carne[0], carne);
    expect(splitNotes(n)).toEqual(['sem pimenta', 'Sem salada', 'Trocar a carne por Almôndegas']);
    n = toggleNote(n, 'Sem salada');
    expect(n).toBe('sem pimenta; Trocar a carne por Almôndegas');
  });
  it('só uma troca por grupo: escolher outra carne substitui a anterior', () => {
    let n = toggleNote('', carne[0], carne);
    n = toggleNote(n, carne[1], carne);
    expect(n).toBe('Trocar a carne por Coxa assada');
    expect(hasNote(n, carne[0])).toBe(false);
  });
  it('reconhece mesmo com maiúsculas/minúsculas diferentes', () => {
    expect(hasNote('sem SALADA', 'Sem salada')).toBe(true);
    expect(toggleNote('sem SALADA', 'Sem salada')).toBe('');
  });
});

describe('lista de observações rápidas nas Configurações', () => {
  it('vem preenchida e a responsável pode trocar', async () => {
    expect(DEFAULT_SETTINGS.quickNotes).toContain('Sem salada');
    const server = createApp(openDb(':memory:'), 'segredo', { mailer: null, route: null, places: null }).listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const j = (m: string, u: string, b?: any, t?: string) => fetch(base + u, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() as any }));
    const t = (await j('POST', '/auth/setup', { name: 'Gisa', email: 'gisa@x.com', password: 'feijoada7' })).body.token;
    const s = (await j('GET', '/settings', undefined, t)).body;
    expect(s.quickNotes).toEqual(DEFAULT_SETTINGS.quickNotes);
    const { modules, ...rest } = s;
    const ok = await j('PUT', '/settings', { ...rest, quickNotes: ['Sem cebola', 'Ovo à parte'] }, t);
    expect(ok.status).toBe(200);
    expect((await j('GET', '/settings', undefined, t)).body.quickNotes).toEqual(['Sem cebola', 'Ovo à parte']);
    const bad = await j('PUT', '/settings', { ...rest, quickNotes: ['x'.repeat(41)] }, t);
    expect(bad.status).toBe(400);
    server.close();
  });
});
