import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb } from './db';
import { createApp } from './app';
import { modulesFromEnv } from './modules';
import { createProduct, getProduct } from './services/inventory';
import { createOrder, getOrder, setOrderStatus, updateOrder } from './services/orders';
import { saveRecipe } from './services/recipes';
import { getMenu, saveMenu, setSoldOut } from './services/menu';
import { localNow } from './money';
import type { Ctx } from './services/common';

let ctx: Ctx;
const D = localNow('America/Sao_Paulo').date;
const order = (items: any[], over: any = {}) => createOrder(ctx, {
  orderDate: D, orderTime: '12:00', source: 'whatsapp', deliveryType: 'retirada',
  items, deliveryFeeCents: 0, deliveryCostCents: 0, discountCents: 0, paymentStatus: 'pendente', ...over,
});
const menuDoDia = [
  { name: 'Opção 1', description: 'Frango grelhado, arroz, feijão e salada', sizes: ['350 g', '450 g'], soldOut: false },
  { name: 'Opção 2', description: 'Bife acebolado, arroz, feijão e fritas', sizes: ['650 g', '750 g'], soldOut: false },
];

beforeEach(() => { ctx = { db: openDb(':memory:'), userId: null, role: 'owner' }; });

describe('cardápio do dia', () => {
  it('sem cardápio montado, usa o modelo das Configurações (não salvo)', () => {
    const m = getMenu(ctx, D);
    expect(m.saved).toBe(false);
    expect(m.options.map((o) => o.name)).toEqual(['Opção 1', 'Opção 2']);
    expect(m.previous).toBeNull();
  });

  it('salva, mostra o anterior para copiar e valida nomes/tamanhos', () => {
    saveMenu(ctx, '2026-01-10', menuDoDia);
    const m = getMenu(ctx, '2026-01-11');
    expect(m.saved).toBe(false);
    expect(m.previous?.date).toBe('2026-01-10');
    expect(m.previous?.options[0].description).toMatch(/Frango/);
    expect(() => saveMenu(ctx, D, [])).toThrow(/pelo menos uma/);
    expect(() => saveMenu(ctx, D, [{ ...menuDoDia[0] }, { ...menuDoDia[0], name: ' opção 1 ' }])).toThrow(/duas opções/);
    expect(() => saveMenu(ctx, D, [{ ...menuDoDia[0], sizes: ['Gigante'] }])).toThrow(/não existe/);
    expect(() => saveMenu(ctx, '2026-02-30', menuDoDia)).toThrow(/inválida/);
  });

  it('pedido grava a descrição do dia; opção esgotada não entra em pedido novo', () => {
    saveMenu(ctx, D, menuDoDia);
    const o = order([{ size: '450 g', qty: 1, unitPriceCents: 1400, option: 'Opção 1' }]);
    expect(o.items[0]).toMatchObject({ option: 'Opção 1', optionDescription: 'Frango grelhado, arroz, feijão e salada' });

    setSoldOut(ctx, D, 'Opção 1', true);
    expect(getMenu(ctx, D).options[0].soldOut).toBe(true);
    expect(() => order([{ size: '450 g', qty: 1, unitPriceCents: 1400, option: 'Opção 1' }])).toThrow(/esgotou/);
    expect(() => order([{ size: '450 g', qty: 1, unitPriceCents: 1400, option: 'Opção 9' }])).toThrow(/não está no cardápio/);

    // o pedido que já tinha a Opção 1 continua podendo ser editado, com a descrição da época
    saveMenu(ctx, D, [{ ...menuDoDia[0], description: 'Mudou', soldOut: true }, menuDoDia[1]]);
    const e = updateOrder(ctx, o.id, { orderDate: D, orderTime: '12:00', source: 'whatsapp', deliveryType: 'retirada', items: [{ size: '450 g', qty: 2, unitPriceCents: 1400, option: 'Opção 1' }], deliveryFeeCents: 0, deliveryCostCents: 0, discountCents: 0, paymentStatus: 'pendente' });
    expect(e.items[0]).toMatchObject({ qty: 2, optionDescription: 'Frango grelhado, arroz, feijão e salada' });
    expect(getOrder(ctx, o.id).totalCents).toBe(2800);
  });

  it('esgotou sem cardápio salvo: salva o modelo e marca', () => {
    const m = setSoldOut(ctx, D, 'Opção 2', true);
    expect(m.saved).toBe(true);
    expect(m.options.find((o) => o.name === 'Opção 2')!.soldOut).toBe(true);
    expect(() => setSoldOut(ctx, D, 'Nada', true)).toThrow(/não está no cardápio/);
  });
});

describe('módulos extras', () => {
  it('lê MODULOS_EXTRAS (desligados por padrão)', () => {
    expect(modulesFromEnv({})).toEqual({ fichas: false, estoqueCompleto: false });
    expect(modulesFromEnv({ MODULOS_EXTRAS: 'fichas' })).toEqual({ fichas: true, estoqueCompleto: false });
    expect(modulesFromEnv({ MODULOS_EXTRAS: 'Fichas, estoque_completo' })).toEqual({ fichas: true, estoqueCompleto: true });
    expect(modulesFromEnv({ MODULOS_EXTRAS: 'todos' })).toEqual({ fichas: true, estoqueCompleto: true });
  });

  it('sem o módulo de fichas, entregar o pedido não mexe no estoque', () => {
    const arroz = createProduct(ctx, { name: 'Arroz', unit: 'kg', qtyMilli: 10000, minQtyMilli: 0, unitCostCents: 600, active: true });
    saveRecipe(ctx, '450 g', [{ productId: arroz.id, qtyMilli: 150 }]);
    const simples: Ctx = { ...ctx, modules: { fichas: false, estoqueCompleto: false } };
    const o = createOrder(simples, { orderDate: D, orderTime: '12:00', source: 'presencial', deliveryType: 'retirada', items: [{ size: '450 g', qty: 2, unitPriceCents: 1400 }], deliveryFeeCents: 0, deliveryCostCents: 0, discountCents: 0, paymentStatus: 'pendente' });
    setOrderStatus(simples, o.id, 'entregue');
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(10000);
    // com o módulo ligado, baixa
    const completo: Ctx = { ...ctx, modules: { fichas: true, estoqueCompleto: false } };
    setOrderStatus(completo, o.id, 'pronto'); setOrderStatus(completo, o.id, 'entregue');
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(9700);
  });
});

describe('API do cardápio e dos módulos', () => {
  let server: Server; let base: string; let token: string;
  const call = async (method: string, url: string, body?: unknown) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() as any };
  };
  beforeAll(async () => {
    server = createApp(openDb(':memory:'), 'segredo', { mailer: null, modules: { fichas: false, estoqueCompleto: false } }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const s = await fetch(base + '/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Gisa', email: 'g@x.com', password: 'cozinha26' }) });
    token = ((await s.json()) as any).token;
  });
  afterAll(() => server.close());

  it('configurações informam os módulos; fichas desligadas respondem 403', async () => {
    expect((await call('GET', '/api/settings')).body.modules).toEqual({ fichas: false, estoqueCompleto: false });
    const r = await call('GET', '/api/recipes');
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/não estão ativadas/);
  });

  it('monta o cardápio, marca esgotou e recusa datas inválidas', async () => {
    const put = await call('PUT', `/api/menu/${D}`, { options: menuDoDia });
    expect(put.status).toBe(200);
    expect(put.body.saved).toBe(true);
    expect(put.body.updatedBy).toBe('Gisa');
    const so = await call('POST', `/api/menu/${D}/sold-out`, { name: 'Opção 2', soldOut: true });
    expect(so.body.options[1].soldOut).toBe(true);
    expect((await call('GET', '/api/menu/2026-13-01')).status).toBe(400);
  });
});

describe('trocas do cardápio do dia', () => {
  it('salva as trocas, mantém ao marcar esgotou e copia do dia anterior', () => {
    expect(getMenu(ctx, D).swaps.map((g: any) => g.title)).toEqual(['Para trocar a carne', 'Para trocar a guarnição']);
    saveMenu(ctx, D, menuDoDia, [{ title: 'Para trocar a carne', items: ['Almôndegas ao sugo', ' Coxa e sobrecoxa assada ', ''] }, { title: 'Para trocar a guarnição', items: ['Batata frita'] }]);
    expect(getMenu(ctx, D).swaps[0].items).toEqual(['Almôndegas ao sugo', 'Coxa e sobrecoxa assada']);
    setSoldOut(ctx, D, 'Opção 1', true);
    expect(getMenu(ctx, D).swaps[1].items).toEqual(['Batata frita']);
    const next = new Date(D + 'T12:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
    expect(getMenu(ctx, next.toISOString().slice(0, 10)).previous?.swaps[0].items).toHaveLength(2);
    expect(() => saveMenu(ctx, D, menuDoDia, [{ title: '', items: ['x'] }])).toThrow(/título/);
  });
});
