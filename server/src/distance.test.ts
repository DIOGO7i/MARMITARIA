import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb } from './db';
import { createApp } from './app';
import { fullAddress, googleRoutes, RouteFn } from './distance';

describe('Routes API do Google (chamada simulada)', () => {
  it('manda o pedido certo e lê distância, tempo e se o endereço foi aproximado', async () => {
    let sent: any = null;
    const fake = (async (url: string, init: any) => {
      sent = { url, headers: init.headers, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        routes: [{ distanceMeters: 3240, duration: '545s' }],
        geocodingResults: { origin: { type: ['street_address'] }, destination: { type: ['street_address'], placeId: 'x' } },
      }), { status: 200 });
    }) as any;
    const r = await googleRoutes('CHAVE', fake)('R. João Penteado, 2220 - Jardim América, Ribeirão Preto - SP', 'Rua Tibiriçá, 500, Centro, Ribeirão Preto - SP, Brasil');
    expect(r).toEqual({ meters: 3240, seconds: 545, approximate: false });
    expect(sent.url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(sent.headers['X-Goog-Api-Key']).toBe('CHAVE');
    expect(sent.headers['X-Goog-FieldMask']).toBe('routes.distanceMeters,routes.duration,geocodingResults');
    expect(sent.body).toMatchObject({ origin: { address: expect.stringMatching(/João Penteado/) }, destination: { address: expect.stringMatching(/Tibiriçá/) }, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', regionCode: 'br' });
  });

  it('endereço achado só pela rua (sem o número) vem marcado como aproximado', async () => {
    const fake = (async () => new Response(JSON.stringify({ routes: [{ distanceMeters: 5000, duration: '700s' }], geocodingResults: { destination: { type: ['route'] } } }))) as any;
    expect((await googleRoutes('k', fake)('a', 'b'))!.approximate).toBe(true);
    const partial = (async () => new Response(JSON.stringify({ routes: [{ distanceMeters: 5000, duration: '700s' }], geocodingResults: { destination: { type: ['street_address'], partialMatch: true } } }))) as any;
    expect((await googleRoutes('k', partial)('a', 'b'))!.approximate).toBe(true);
  });

  it('sem rota devolve null; erro do Google vira erro claro (sem mostrar a chave)', async () => {
    const none = (async () => new Response(JSON.stringify({}))) as any;
    expect(await googleRoutes('k', none)('a', 'b')).toBeNull();
    const bad = (async () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 })) as any;
    await expect(googleRoutes('SEGREDO', bad)('a', 'b')).rejects.toThrow(/Mapa indisponível \(API key not valid\)/);
  });

  it('monta o endereço completo com a cidade do restaurante', () => {
    expect(fullAddress(' Rua Tibiriçá, 500 ', 'Centro', 'Ribeirão Preto - SP')).toBe('Rua Tibiriçá, 500, Centro, Ribeirão Preto - SP, Brasil');
    expect(fullAddress('Rua A, 1', '', 'Ribeirão Preto - SP')).toBe('Rua A, 1, Ribeirão Preto - SP, Brasil');
  });
});

describe('API /distance', () => {
  let server: Server; let base: string; let token: string;
  const calls: { origin: string; dest: string }[] = [];
  let mode: 'ok' | 'none' | 'fail' = 'ok';
  const route: RouteFn = async (origin, dest) => {
    calls.push({ origin, dest });
    if (mode === 'fail') throw new Error('rede caiu');
    return mode === 'none' ? null : { meters: 3240, seconds: 545, approximate: false };
  };
  const get = async (q: string, t = token) => {
    const r = await fetch(`${base}/api/distance?${q}`, { headers: { authorization: `Bearer ${t}` } });
    return { status: r.status, body: await r.json() as any };
  };
  beforeAll(async () => {
    server = createApp(openDb(':memory:'), 'segredo', { mailer: null, route }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const s = await fetch(base + '/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Gisa', email: 'g@x.com', password: 'feijoada7' }) });
    token = ((await s.json()) as any).token;
  });
  afterAll(() => server.close());

  it('calcula do endereço do restaurante até o cliente, e guarda em cache', async () => {
    const r = await get('street=' + encodeURIComponent('Rua Tibiriçá, 500') + '&neighborhood=Centro');
    expect(r.body).toEqual({ enabled: true, found: true, meters: 3240, seconds: 545, approximate: false });
    expect(calls[0].origin).toBe('R. João Penteado, 2220 - Jardim América, Ribeirão Preto - SP, 14020-180');
    expect(calls[0].dest).toBe('Rua Tibiriçá, 500, Centro, Ribeirão Preto - SP, Brasil');
    // mesmo endereço com acento/maiúscula diferente: vem do cache, sem nova consulta
    await get('street=' + encodeURIComponent('RUA TIBIRICA,  500') + '&neighborhood=centro');
    expect(calls).toHaveLength(1);
  });

  it('endereço que o mapa não acha, falha do mapa e campos inválidos', async () => {
    mode = 'none';
    expect((await get('street=Rua+Inexistente+999')).body).toMatchObject({ enabled: true, found: false, reason: expect.stringMatching(/não achou/) });
    mode = 'fail';
    const f = await get('street=Rua+Outra+1');
    expect(f.status).toBe(502);
    expect(f.body.error).toMatch(/pedido pode ser feito normalmente/);
    expect((await get('street=ab')).status).toBe(400);
    expect((await get('street=Rua+X', 'token-falso')).status).toBe(401);
    mode = 'ok';
  });

  it('sem a chave do mapa, avisa que está desligado', async () => {
    const srv = createApp(openDb(':memory:'), 'segredo', { mailer: null, route: null }).listen(0);
    const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const s = await fetch(b + '/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Gisa', email: 'g@x.com', password: 'feijoada7' }) });
      const t = ((await s.json()) as any).token;
      const r = await fetch(b + '/api/distance?street=Rua+A+1', { headers: { authorization: `Bearer ${t}` } });
      expect(await r.json()).toEqual({ enabled: false });
    } finally { srv.close(); }
  });
});
