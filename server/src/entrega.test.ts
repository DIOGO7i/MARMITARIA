import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb, getSettings } from './db';
import { createApp } from './app';
import { createOrder, setOrderStatus, updateOrder } from './services/orders';
import { googlePlaces, parseComponents, PlacesApi } from './places';
import { localNow } from './money';
import type { Ctx } from './services/common';

const D = localNow('America/Sao_Paulo').date;
let ctx: Ctx;
beforeEach(() => { ctx = { db: openDb(':memory:'), userId: null, role: 'owner' }; });
const base = (over: any = {}) => ({
  orderDate: D, orderTime: '12:00', source: 'whatsapp' as const, deliveryType: 'retirada' as const,
  items: [{ size: '450 g', qty: 1, unitPriceCents: 1400 }], deliveryFeeCents: 0, deliveryCostCents: 0, discountCents: 0, paymentStatus: 'pendente' as const, ...over,
});

describe('retirada tem o próprio caminho de status', () => {
  it('retirada não pode "sair para entrega"; vai de pronto direto para retirado', () => {
    const o = createOrder(ctx, base());
    setOrderStatus(ctx, o.id, 'pronto');
    expect(() => setOrderStatus(ctx, o.id, 'saiu_para_entrega')).toThrow(/retirada não sai para entrega/);
    expect(setOrderStatus(ctx, o.id, 'entregue').deliveredAt).toBeTruthy();
    expect(() => createOrder(ctx, base({ status: 'saiu_para_entrega' }))).toThrow(/retirada/);
  });

  it('entrega que já saiu e vira retirada volta para "pronto"', () => {
    const o = createOrder(ctx, base({ deliveryType: 'entrega', address: 'Rua A, 1', status: 'saiu_para_entrega' }));
    expect(o.status).toBe('saiu_para_entrega');
    const r = updateOrder(ctx, o.id, base());
    expect(r.status).toBe('pronto');
    expect(r.address).toBeNull();
  });
});

describe('frete pela distância', () => {
  it('vem com faixas iniciais e salva faixas novas em ordem', async () => {
    expect(getSettings(ctx.db).deliveryTiers[0]).toEqual({ upToMeters: 2000, feeCents: 500, costCents: 400 });
  });
});

describe('sugestões de endereço (Places do Google, chamada simulada)', () => {
  it('lê rua, número e bairro do endereço escolhido', () => {
    const a = parseComponents([
      { longText: '500', types: ['street_number'] },
      { longText: 'Rua Tibiriçá', types: ['route'] },
      { longText: 'Centro', types: ['sublocality_level_1', 'sublocality', 'political'] },
      { longText: 'Ribeirão Preto', types: ['administrative_area_level_2', 'political'] },
      { longText: 'São Paulo', shortText: 'SP', types: ['administrative_area_level_1', 'political'] },
      { longText: '14010-090', types: ['postal_code'] },
    ], 'R. Tibiriçá, 500 - Centro, Ribeirão Preto - SP, 14010-090, Brasil');
    expect(a).toMatchObject({ street: 'Rua Tibiriçá, 500', number: '500', neighborhood: 'Centro', city: 'Ribeirão Preto', state: 'SP', postalCode: '14010-090' });
    expect(parseComponents([{ longText: 'Rua Tibiriçá', types: ['route'] }]).number).toBeNull();
  });

  it('manda a busca perto do restaurante, só no Brasil, com o token da sessão', async () => {
    const sent: any[] = [];
    const fake = (async (url: string, init: any) => {
      sent.push({ url, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
      if (url.endsWith(':autocomplete')) return new Response(JSON.stringify({ suggestions: [
        { placePrediction: { placeId: 'abc', structuredFormat: { mainText: { text: 'Rua Tibiriçá, 500' }, secondaryText: { text: 'Centro, Ribeirão Preto - SP' } } } },
        { queryPrediction: { text: { text: 'tibiriça' } } },
      ] }));
      return new Response(JSON.stringify({ addressComponents: [{ longText: 'Rua X', types: ['route'] }], formattedAddress: 'Rua X' }));
    }) as any;
    const p = googlePlaces('CHAVE', fake);
    const l = await p.suggest('tibiriça 500', 'sessao-123456', { latitude: -21.2, longitude: -47.8 });
    expect(l).toEqual([{ id: 'abc', main: 'Rua Tibiriçá, 500', secondary: 'Centro, Ribeirão Preto - SP' }]);
    expect(sent[0].headers['X-Goog-Api-Key']).toBe('CHAVE');
    expect(sent[0].body).toMatchObject({ input: 'tibiriça 500', sessionToken: 'sessao-123456', includedRegionCodes: ['br'], locationBias: { circle: { center: { latitude: -21.2 } } } });
    await p.details('abc', 'sessao-123456');
    expect(sent[1].url).toMatch(/places\/abc\?.*sessionToken=sessao-123456/);
    expect(sent[1].headers['X-Goog-FieldMask']).toBe('addressComponents,formattedAddress');
  });
});

describe('API /places', () => {
  let server: Server; let url: string; let token: string;
  let located = 0;
  const places: PlacesApi = {
    async suggest(q, _s, near) { return [{ id: 'abcdef', main: q, secondary: near ? 'perto' : 'longe' }]; },
    async details(id) { return id === 'abcdef' ? parseComponents([{ longText: 'Rua Tibiriçá', types: ['route'] }, { longText: '500', types: ['street_number'] }, { longText: 'Centro', types: ['sublocality_level_1'] }]) : null; },
    async locate() { located++; return { latitude: -21.2, longitude: -47.8 }; },
  };
  const get = async (q: string) => { const r = await fetch(`${url}/api/${q}`, { headers: { authorization: `Bearer ${token}` } }); return { status: r.status, body: await r.json() as any }; };
  beforeAll(async () => {
    server = createApp(openDb(':memory:'), 'segredo', { mailer: null, route: null, places }).listen(0);
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const s = await fetch(url + '/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Gisa', email: 'g@x.com', password: 'feijoada7' }) });
    token = ((await s.json()) as any).token;
  });
  afterAll(() => server.close());

  it('sugere endereços perto do restaurante (o ponto do restaurante é consultado uma vez só)', async () => {
    const a = await get('places/suggest?q=tibirica+500&session=sessao-123456');
    expect(a.body).toEqual({ enabled: true, suggestions: [{ id: 'abcdef', main: 'tibirica 500', secondary: 'perto' }] });
    await get('places/suggest?q=tibirica+501&session=sessao-123456');
    expect(located).toBe(1);
  });

  it('detalhe devolve rua com número e bairro; entradas inválidas são recusadas', async () => {
    expect((await get('places/details?id=abcdef&session=sessao-123456')).body).toMatchObject({ enabled: true, found: true, street: 'Rua Tibiriçá, 500', neighborhood: 'Centro' });
    expect((await get('places/details?id=zzzzz&session=sessao-123456')).body).toEqual({ enabled: true, found: false });
    expect((await get('places/details?id=a/b/../c&session=sessao-123456')).status).toBe(400);
    expect((await get('places/suggest?q=ab&session=sessao-123456')).status).toBe(400);
    expect((await get('places/suggest?q=rua+x&session=x')).status).toBe(400);
  });

  it('sem a chave do mapa, avisa que está desligado', async () => {
    const srv = createApp(openDb(':memory:'), 'segredo', { mailer: null, route: null, places: null }).listen(0);
    const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const s = await fetch(b + '/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Gisa', email: 'g@x.com', password: 'feijoada7' }) });
      const t = ((await s.json()) as any).token;
      const r = await fetch(b + '/api/places/suggest?q=rua+a+1&session=sessao-123456', { headers: { authorization: `Bearer ${t}` } });
      expect(await r.json()).toEqual({ enabled: false, suggestions: [] });
    } finally { srv.close(); }
  });

  it('salva faixas de frete em ordem e recusa faixa repetida', async () => {
    const cur = (await get('settings')).body;
    const put = (deliveryTiers: any) => fetch(`${url}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ ...cur, modules: undefined, timezone: undefined, deliveryTiers }) });
    expect((await put([{ upToMeters: 3000, feeCents: 600, costCents: 500 }, { upToMeters: 7000, feeCents: 1100, costCents: 900 }])).status).toBe(200);
    expect((await get('settings')).body.deliveryTiers).toHaveLength(2);
    expect((await put([{ upToMeters: 3000, feeCents: 600, costCents: 500 }, { upToMeters: 3000, feeCents: 1100, costCents: 900 }])).status).toBe(400);
  });
});
