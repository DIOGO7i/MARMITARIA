import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from './db';
import { createProduct, getProduct, listMovements } from './services/inventory';
import { createOrder, setOrderStatus, updateOrder, getOrder } from './services/orders';
import { listRecipes, saveRecipe } from './services/recipes';
import { cashDay, openCash, addCashMovement, closeCash, reopenCash } from './services/cash';
import { payables, summary } from './services/reports';
import { createExpense, payExpense } from './services/expenses';
import { createPurchase } from './services/purchases';
import { verifyBalances } from './stock';
import { localNow } from './money';
import type { Ctx } from './services/common';

let ctx: Ctx;
const today = () => localNow('America/Sao_Paulo').date;
const setSetting = (k: string, v: unknown) => ctx.db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(JSON.stringify(v), k);
const order = (over: any = {}) => createOrder(ctx, {
  orderDate: today(), orderTime: '12:00', source: 'presencial', deliveryType: 'retirada',
  items: [{ size: '450 g', qty: 2, unitPriceCents: 2200 }], deliveryFeeCents: 0, deliveryCostCents: 0, discountCents: 0, paymentStatus: 'pendente', ...over,
});

beforeEach(() => { ctx = { db: openDb(':memory:'), userId: null, role: 'owner' }; });

describe('ficha técnica', () => {
  let arroz: any, frango: any, emb: any;
  beforeEach(() => {
    arroz = createProduct(ctx, { name: 'Arroz', unit: 'kg', qtyMilli: 10000, minQtyMilli: 0, unitCostCents: 600, active: true });
    frango = createProduct(ctx, { name: 'Frango', unit: 'kg', qtyMilli: 5000, minQtyMilli: 0, unitCostCents: 1600, active: true });
    emb = createProduct(ctx, { name: 'Marmitex', unit: 'unidade', qtyMilli: 100000, minQtyMilli: 0, unitCostCents: 62, active: true });
    saveRecipe(ctx, '450 g', [{ productId: arroz.id, qtyMilli: 150 }, { productId: frango.id, qtyMilli: 120 }, { productId: emb.id, qtyMilli: 1000 }]);
  });

  it('calcula custo e lucro da marmita e alerta margem baixa', () => {
    const r = listRecipes(ctx).sizes.find((s) => s.size === '450 g')!;
    // 0,150 × 6,00 + 0,120 × 16,00 + 1 × 0,62 = 0,90 + 1,92 + 0,62 = 3,44
    expect(r.costCents).toBe(344);
    expect(r.marginCents).toBe(1400 - 344);
    expect(r.marginPct).toBe(75.4);
    expect(r.lowMargin).toBe(false);
    setSetting('minMarginPct', 90);
    expect(listRecipes(ctx).sizes.find((s) => s.size === '450 g')!.lowMargin).toBe(true);
    expect(listRecipes(ctx).sizes.find((s) => s.size === '350 g')!.hasRecipe).toBe(false);
  });

  it('baixa só ao entregar (padrão), uma vez, e estorna ao cancelar', () => {
    const o = order();
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(10000); // pendente: não baixa
    setOrderStatus(ctx, o.id, 'em_preparo');
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(10000);
    setOrderStatus(ctx, o.id, 'entregue');
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(10000 - 300); // 2 marmitas × 150 g
    expect(getProduct(ctx, frango.id).qtyMilli).toBe(5000 - 240);
    expect(getProduct(ctx, emb.id).qtyMilli).toBe(100000 - 2000);
    setOrderStatus(ctx, o.id, 'cancelado', { reason: 'devolvido' });
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(10000);
    setOrderStatus(ctx, o.id, 'pendente'); // reaberto: não baixa de novo
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(10000);
    setOrderStatus(ctx, o.id, 'entregue');
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(9700);
    expect(verifyBalances(ctx.db)).toEqual([]);
  });

  it('editar pedido já baixado ajusta a diferença; voltar status estorna', () => {
    const o = order({ status: 'entregue' });
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(9700);
    const full = getOrder(ctx, o.id) as any;
    updateOrder(ctx, o.id, { ...full, items: [{ size: '450 g', qty: 3, unitPriceCents: 2200 }], deliveredAt: null });
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(10000 - 450);
    setOrderStatus(ctx, o.id, 'pronto');
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(10000);
    expect(verifyBalances(ctx.db)).toEqual([]);
  });

  it('respeita o momento configurado e o modo desativado', () => {
    setSetting('stockDeductOn', 'em_preparo');
    const o = order();
    setOrderStatus(ctx, o.id, 'em_preparo');
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(9700);
    setOrderStatus(ctx, o.id, 'entregue'); // não baixa duas vezes
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(9700);
    setSetting('stockDeductOn', 'desativado');
    order({ status: 'entregue' });
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(9700);
  });

  it('tamanho sem ficha não baixa nada; falta de estoque não trava o pedido', () => {
    order({ items: [{ size: '650 g', qty: 1, unitPriceCents: 2600 }], status: 'entregue' });
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(10000);
    const o = order({ items: [{ size: '450 g', qty: 50, unitPriceCents: 2200 }], status: 'entregue' }); // precisa 6 kg de frango, tem 5
    expect(o.status).toBe('entregue');
    expect(getProduct(ctx, frango.id).qtyMilli).toBe(5000 - 6000);
    expect(getProduct(ctx, frango.id).stockStatus).toBe('sem_estoque');
  });

  it('a baixa entra como custo dos insumos no resultado', () => {
    order({ status: 'entregue', paymentStatus: 'pago' });
    const s = summary(ctx, today(), today());
    expect(s.consumptionCostCents).toBe(688); // 2 × 3,44
    expect(s.estimateMissing.join(' ')).not.toMatch(/custo das mercadorias/);
    expect(listMovements(ctx, { productId: arroz.id })[0].notes).toMatch(/ficha técnica/);
  });
});

describe('bairro do pedido', () => {
  it('guarda o bairro só para entrega', () => {
    const o = order({ deliveryType: 'entrega', address: 'Rua A, 1', neighborhood: 'Centro', deliveryFeeCents: 500, deliveryCostCents: 400 });
    expect(o.neighborhood).toBe('Centro');
    expect(order({ neighborhood: 'Centro' }).neighborhood).toBeNull();
  });
});

describe('caixa do dia', () => {
  it('esperado = troco + dinheiro recebido − dinheiro pago + suprimento − sangria; mostra sobra/falta', () => {
    const d = today();
    expect(cashDay(ctx, d).status).toBe('nao_aberto');
    expect(() => addCashMovement(ctx, d, 'sangria', 100, 'x')).toThrow(/Abra o caixa/);
    openCash(ctx, d, 10000); // R$ 100 de troco
    order({ paymentStatus: 'pago', paymentMethod: 'Dinheiro' });               // + 44,00 em dinheiro
    order({ paymentStatus: 'pago', paymentMethod: 'Pix' });                    // Pix não entra na gaveta
    const e = createExpense(ctx, { description: 'Gás', category: 'Gás', expenseDate: d, amountCents: 3000, status: 'pendente', paymentMethod: 'Dinheiro' });
    payExpense(ctx, e.id, { method: 'Dinheiro', paidDate: d });              // − 30,00 em dinheiro
    addCashMovement(ctx, d, 'suprimento', 2000, 'troco extra');                // + 20,00
    const c = addCashMovement(ctx, d, 'sangria', 5000, 'depósito no banco');  // − 50,00
    expect(c.expectedCashCents).toBe(10000 + 4400 - 3000 + 2000 - 5000);
    expect(c.received.find((r) => r.method === 'Pix')!.totalCents).toBe(4400);
    const closed = closeCash(ctx, d, { countedCashCents: 8300, leftInDrawerCents: 5000, checks: { Pix: 4400 } });
    expect(closed.status).toBe('fechado');
    expect(closed.differenceCents).toBe(-100); // faltou R$ 1,00
    expect(() => addCashMovement(ctx, d, 'sangria', 100, 'x')).toThrow(/fechado/);
    expect(() => closeCash(ctx, d, { countedCashCents: 1, leftInDrawerCents: 0 })).toThrow(/fechado/);
    const next = new Date(d + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
    expect(cashDay(ctx, next.toISOString().slice(0, 10)).suggestedOpeningCents).toBe(5000); // sugere o que ficou na gaveta
    expect(reopenCash(ctx, d).status).toBe('aberto');
  });
});

describe('contas a vencer', () => {
  it('separa vencidas, hoje, em breve e sem vencimento', () => {
    const d = today();
    const add = (n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    createExpense(ctx, { description: 'Luz', category: 'Energia elétrica', expenseDate: d, amountCents: 20000, status: 'pendente', dueDate: add(-2) });
    createExpense(ctx, { description: 'Água', category: 'Água', expenseDate: d, amountCents: 8000, status: 'pendente', dueDate: d });
    createExpense(ctx, { description: 'Aluguel', category: 'Aluguel', expenseDate: d, amountCents: 150000, status: 'pendente', dueDate: add(2) });
    createExpense(ctx, { description: 'Internet', category: 'Internet', expenseDate: d, amountCents: 10000, status: 'pendente', dueDate: add(20) });
    createExpense(ctx, { description: 'Gás', category: 'Gás', expenseDate: d, amountCents: 12000, status: 'pago', dueDate: add(-1) });
    const p = createProduct(ctx, { name: 'Arroz', unit: 'kg', minQtyMilli: 0, unitCostCents: 0, active: true });
    createPurchase(ctx, { idempotencyKey: 'pay-1', purchaseDate: d, items: [{ productId: p.id, qtyMilli: 1000, totalCents: 5000 }], discountCents: 0, freightCents: 0, paymentStatus: 'parcial', paidCents: 1000, dueDate: add(1) });
    const r = payables(ctx, 3);
    expect(r.overdue).toEqual({ count: 1, totalCents: 20000 });
    expect(r.dueToday).toEqual({ count: 1, totalCents: 8000 });
    expect(r.dueSoon).toEqual({ count: 2, totalCents: 150000 + 4000 });
    expect(r.items.map((i) => i.description)).not.toContain('Internet'); // vence depois do período
    expect(r.items.map((i) => i.description)).not.toContain('Gás');      // já paga
  });
});
