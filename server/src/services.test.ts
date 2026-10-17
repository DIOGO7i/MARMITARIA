import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from './db';
import { verifyBalances } from './stock';
import { createProduct, registerStockOut, inventoryAdjust, listMovements, getProduct, listProducts } from './services/inventory';
import { createPurchase, cancelPurchase, addPurchasePayment, allocateExtras } from './services/purchases';
import { createOrder, setOrderStatus, addOrderPayment, updateOrder, listOrders, getOrder } from './services/orders';
import { createExpense, voidExpense, payExpense } from './services/expenses';
import { summary } from './services/reports';
import type { Ctx } from './services/common';
import { ValidationError, localNow } from './money';
const D = localNow('America/Sao_Paulo').date; // data de hoje: estornos e pagamentos usam o dia atual

let ctx: Ctx;
const prod = (name: string, extra: any = {}) =>
  createProduct(ctx, { name, unit: 'kg', minQtyMilli: 2000, unitCostCents: 0, active: true, ...extra });
const purchase = (productId: number, over: any = {}) =>
  createPurchase(ctx, {
    idempotencyKey: crypto.randomUUID(), purchaseDate: D,
    items: [{ productId, qtyMilli: 10000, totalCents: 6000 }],
    discountCents: 0, freightCents: 0, paymentStatus: 'pago', ...over,
  });
const order = (over: any = {}) =>
  createOrder(ctx, {
    orderDate: D, orderTime: '12:00', source: 'whatsapp', deliveryType: 'retirada',
    items: [{ size: '450 g', qty: 2, unitPriceCents: 2200 }], deliveryFeeCents: 0, deliveryCostCents: 0,
    discountCents: 0, paymentStatus: 'pendente', ...over,
  });

beforeEach(() => {
  ctx = { db: openDb(':memory:'), userId: null, role: 'owner' };
});

describe('compras e estoque', () => {
  it('compra de 10 kg de arroz por R$ 60 => custo R$ 6/kg e estoque 10 kg', () => {
    const arroz = prod('Arroz');
    const c = purchase(arroz.id);
    expect(c.totalCents).toBe(6000);
    const p = getProduct(ctx, arroz.id);
    expect(p.qtyMilli).toBe(10000);
    expect(p.unitCostCents).toBe(600);
    expect(verifyBalances(ctx.db)).toEqual([]);
  });

  it('mesma chave de idempotência não atualiza o estoque duas vezes', () => {
    const arroz = prod('Arroz');
    const key = 'abc-123';
    const a = purchase(arroz.id, { idempotencyKey: key });
    const b = purchase(arroz.id, { idempotencyKey: key });
    expect(b.duplicate).toBe(true);
    expect(b.id).toBe(a.id);
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(10000);
    expect((ctx.db.prepare('SELECT COUNT(*) c FROM purchases').get() as any).c).toBe(1);
  });

  it('custo médio ponderado entre duas compras', () => {
    const arroz = prod('Arroz');
    purchase(arroz.id); // 10 kg a 6,00
    purchase(arroz.id, { items: [{ productId: arroz.id, qtyMilli: 10000, totalCents: 8000 }] }); // 10 kg a 8,00
    expect(getProduct(ctx, arroz.id).unitCostCents).toBe(700);
  });

  it('frete e desconto são rateados no custo efetivo', () => {
    expect(allocateExtras([3000, 1000], 400)).toEqual([300, 100]);
    const arroz = prod('Arroz');
    purchase(arroz.id, { freightCents: 1000 }); // 60 + 10 de frete = 70 / 10kg
    expect(getProduct(ctx, arroz.id).unitCostCents).toBe(700);
  });

  it('rejeita o mesmo produto duas vezes na compra', () => {
    const arroz = prod('Arroz');
    expect(() => purchase(arroz.id, { items: [{ productId: arroz.id, qtyMilli: 1000, totalCents: 100 }, { productId: arroz.id, qtyMilli: 1000, totalCents: 100 }] })).toThrow(ValidationError);
  });

  it('pagamento parcial e quitação posterior', () => {
    const arroz = prod('Arroz');
    const c = purchase(arroz.id, { paymentStatus: 'parcial', paidCents: 2000 });
    expect(c.paymentStatus).toBe('parcial');
    expect(c.openCents).toBe(4000);
    const q = addPurchasePayment(ctx, c.id, { amountCents: 4000 });
    expect(q.paymentStatus).toBe('pago');
    expect(() => addPurchasePayment(ctx, c.id, { amountCents: 1 })).toThrow(/ultrapassa/);
  });

  it('cancelar compra estorna estoque e pagamentos, e não duplica', () => {
    const arroz = prod('Arroz');
    const c = purchase(arroz.id);
    cancelPurchase(ctx, c.id, 'erro de digitação');
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(0);
    expect(verifyBalances(ctx.db)).toEqual([]);
    expect(() => cancelPurchase(ctx, c.id, 'de novo')).toThrow(/já foi cancelada/);
    const s = summary(ctx, '2026-10-01', '2026-10-31');
    expect(s.purchasesCents).toBe(0);
    expect(s.paymentsMadeCents).toBe(0);
  });

  it('não cancela compra se o estoque já foi consumido', () => {
    const arroz = prod('Arroz');
    const c = purchase(arroz.id);
    registerStockOut(ctx, { productId: arroz.id, qtyMilli: 8000, reason: 'consumo' });
    expect(() => cancelPurchase(ctx, c.id, 'x')).toThrow(/Estoque insuficiente/);
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(2000); // nada foi alterado
  });
});

describe('saídas e histórico', () => {
  it('saída reduz o estoque e registra saldo anterior/posterior', () => {
    const arroz = prod('Arroz');
    purchase(arroz.id);
    registerStockOut(ctx, { productId: arroz.id, qtyMilli: 3500, reason: 'consumo' });
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(6500);
    const [m] = listMovements(ctx, { productId: arroz.id, type: 'saida' });
    expect(m.balanceBeforeMilli).toBe(10000);
    expect(m.balanceAfterMilli).toBe(6500);
    expect(verifyBalances(ctx.db)).toEqual([]);
  });

  it('impede saída maior que o estoque', () => {
    const arroz = prod('Arroz');
    purchase(arroz.id);
    expect(() => registerStockOut(ctx, { productId: arroz.id, qtyMilli: 10001, reason: 'perda' })).toThrow(/insuficiente/);
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(10000);
  });

  it('editar o produto não altera saldo nem histórico', () => {
    const arroz = prod('Arroz', { qtyMilli: 5000 });
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(5000);
    ctx.db.prepare('UPDATE products SET name = ? WHERE id = ?').run('Arroz tipo 1', arroz.id);
    expect(listMovements(ctx, { productId: arroz.id })).toHaveLength(1);
    expect(verifyBalances(ctx.db)).toEqual([]);
  });

  it('ajuste de inventário gera movimentação com a diferença', () => {
    const arroz = prod('Arroz', { qtyMilli: 5000 });
    inventoryAdjust(ctx, { productId: arroz.id, countedMilli: 4200 });
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(4200);
    expect(listMovements(ctx, { productId: arroz.id })[0].qtyMilli).toBe(-800);
    expect(() => inventoryAdjust(ctx, { productId: arroz.id, countedMilli: 4200 })).toThrow();
  });

  it('alertas: baixo e sem estoque', () => {
    const a = prod('Arroz', { qtyMilli: 2000 }); // = mínimo => baixo
    const b = prod('Feijão'); // 0 => sem estoque
    const c = prod('Sal', { qtyMilli: 9000 });
    const st = (id: number) => listProducts(ctx, {}).find((p) => p.id === id)!.stockStatus;
    expect(st(a.id)).toBe('baixo');
    expect(st(b.id)).toBe('sem_estoque');
    expect(st(c.id)).toBe('ok');
  });

  it('pedido NÃO baixa ingredientes automaticamente', () => {
    const arroz = prod('Arroz', { qtyMilli: 5000 });
    order();
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(5000);
  });
});

describe('pedidos', () => {
  it('calcula total, identifica origem e é idempotente', () => {
    const o = order({ items: [{ size: '650 g', qty: 3, unitPriceCents: 2600 }], deliveryType: 'entrega', address: 'Rua A, 10', deliveryFeeCents: 500, deliveryCostCents: 400, discountCents: 300, source: 'whatsapp', idempotencyKey: 'k1' });
    expect(o.subtotalCents).toBe(7800);
    expect(o.totalCents).toBe(8000);
    expect(o.source).toBe('whatsapp');
    expect(order({ idempotencyKey: 'k1' }).duplicate).toBe(true);
    expect((ctx.db.prepare('SELECT COUNT(*) c FROM orders').get() as any).c).toBe(1);
  });

  it('entrega exige endereço; desconto não pode negativar', () => {
    expect(() => order({ deliveryType: 'entrega' })).toThrow(/endereço/);
    expect(() => order({ discountCents: 999999 })).toThrow(/negativo/);
  });

  it('entregue registra horário real; voltar status limpa; atrasado calculado', () => {
    const o = order({ expectedAt: '2000-01-01T10:00' });
    expect(listOrders(ctx, { late: true }).total).toBe(1);
    const d = setOrderStatus(ctx, o.id, 'entregue');
    expect(d.deliveredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(d.late).toBe(false);
    expect(listOrders(ctx, { late: true }).total).toBe(0);
  });

  it('cancelar exige motivo, estorna recebimento e mantém histórico', () => {
    const o = order({ paymentStatus: 'pago', paymentMethod: 'Pix' });
    expect(() => setOrderStatus(ctx, o.id, 'cancelado')).toThrow(/motivo/);
    const c = setOrderStatus(ctx, o.id, 'cancelado', { reason: 'cliente desistiu' });
    expect(c.status).toBe('cancelado');
    expect(c.totalCents).toBe(4400); // valor preservado
    expect(c.payments).toHaveLength(2); // recebimento + estorno
    const s = summary(ctx, D, D);
    expect(s.salesCents).toBe(0);
    expect(s.receivedCents).toBe(0);
    expect(s.orders.cancelled).toBe(1);
    expect(s.orders.registered).toBe(1);
  });

  it('recebimentos parciais atualizam status e valor a receber', () => {
    const o = order();
    const p = addOrderPayment(ctx, o.id, { amountCents: 1000, method: 'Pix' });
    expect(p.paymentStatus).toBe('parcial');
    const s = summary(ctx, '2026-10-01', '2026-10-31');
    expect(s.salesCents).toBe(4400);
    expect(s.receivedCents).toBe(1000);
    expect(s.receivableCents).toBe(3400);
    expect(() => addOrderPayment(ctx, o.id, { amountCents: 9999 })).toThrow(/ultrapassa/);
  });

  it('editar preserva preço do pedido antigo e impede total menor que o recebido', () => {
    const o = order({ paymentStatus: 'pago' });
    expect(() => updateOrder(ctx, o.id, { ...(o as any), items: [{ size: '450 g', qty: 1, unitPriceCents: 2200 }], deliveryFeeCents: 0, deliveryCostCents: 0, discountCents: 0, paymentStatus: 'pago' })).toThrow(/menor que o valor já recebido/);
    expect(getOrder(ctx, o.id).totalCents).toBe(4400);
  });

  it('staff não corrige horário real da entrega', () => {
    const o = order();
    const staff: Ctx = { ...ctx, role: 'staff' };
    expect(() => setOrderStatus(staff, o.id, 'entregue', { deliveredAt: '2026-10-12T13:00' })).toThrow(/responsável/);
  });
});

describe('despesas e relatórios', () => {
  it('separa vendas, recebimentos, compras, despesas e contas a pagar', () => {
    const arroz = prod('Arroz');
    purchase(arroz.id, { paymentStatus: 'pendente' }); // 60,00 a pagar
    order({ paymentStatus: 'pago' }); // 44,00 vendido e recebido
    order({ items: [{ size: '350 g', qty: 1, unitPriceCents: 1800 }] }); // 18,00 a receber
    const e = createExpense(ctx, { description: 'Gás', category: 'Gás', expenseDate: D, amountCents: 10000, status: 'pendente' });
    const s = summary(ctx, D, D);
    expect(s.salesCents).toBe(6200);
    expect(s.receivedCents).toBe(4400);
    expect(s.receivableCents).toBe(1800);
    expect(s.purchasesCents).toBe(6000);
    expect(s.expensesCents).toBe(10000);
    expect(s.paymentsMadeCents).toBe(0);
    expect(s.payablesPendingCents).toBe(16000);
    payExpense(ctx, e.id, { method: 'Pix' });
    const s2 = summary(ctx, D, D);
    expect(s2.paymentsMadeCents).toBe(10000);
    expect(s2.payablesPendingCents).toBe(6000);
  });

  it('estimativa de resultado não subtrai compras e avisa o que falta', () => {
    const arroz = prod('Arroz');
    purchase(arroz.id);
    order({ paymentStatus: 'pago' });
    const s = summary(ctx, D, D);
    expect(s.operatingEstimateCents).toBe(4400); // compra de 60,00 não entra
    expect(s.estimateMissing.join(' ')).toMatch(/custo das mercadorias/);
    registerStockOut(ctx, { productId: arroz.id, qtyMilli: 2000, reason: 'consumo', occurredAt: `${D}T15:00` });
    const s2 = summary(ctx, D, D);
    expect(s2.consumptionCostCents).toBe(1200);
    expect(s2.operatingEstimateCents).toBe(3200);
  });

  it('entregadores lançados como despesa não duplicam o custo de entrega', () => {
    order({ deliveryType: 'entrega', address: 'x', deliveryCostCents: 500 });
    createExpense(ctx, { description: 'Motoboy', category: 'Pagamento a entregadores', expenseDate: D, amountCents: 500, status: 'pago' });
    const s = summary(ctx, D, D);
    expect(s.operatingEstimateCents).toBe(4400 - 500);
  });

  it('anular despesa paga estorna o pagamento e some dos totais', () => {
    const e = createExpense(ctx, { description: 'Água', category: 'Água', expenseDate: D, amountCents: 3000, status: 'pago' });
    voidExpense(ctx, e.id, 'lançada errada');
    const s = summary(ctx, D, D);
    expect(s.expensesCents).toBe(0);
    expect(s.paymentsMadeCents).toBe(0);
  });

  it('filtros de data do relatório respeitam o período', () => {
    order({ orderDate: '2026-10-11' });
    order({ orderDate: '2026-10-12' });
    expect(summary(ctx, '2026-10-12', '2026-10-12').orders.registered).toBe(1);
    expect(summary(ctx, '2026-10-01', '2026-10-31').orders.registered).toBe(2);
  });
});

describe('formas de pagamento', () => {
  it('não oferece "Fiado" e remove de instalações antigas, uma única vez', async () => {
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    const { getSettings } = await import('./db');
    expect(getSettings(openDb(':memory:')).paymentMethods).not.toContain('Fiado');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-')), 'old.db');
    const old = openDb(file);
    old.prepare("UPDATE settings SET value = ? WHERE key = 'paymentMethods'").run(JSON.stringify(['Dinheiro', 'Pix', 'Fiado']));
    old.prepare("DELETE FROM settings WHERE key = 'migr_sem_fiado'").run();
    old.close();
    const reopened = openDb(file);
    expect(getSettings(reopened).paymentMethods).toEqual(['Dinheiro', 'Pix']);
    expect(Object.keys(getSettings(reopened))).not.toContain('migr_sem_fiado');
    // se a pessoa adicionar "Fiado" de novo por conta própria, não é removido outra vez
    reopened.prepare("UPDATE settings SET value = ? WHERE key = 'paymentMethods'").run(JSON.stringify(['Dinheiro', 'Fiado']));
    reopened.close();
    expect(getSettings(openDb(file)).paymentMethods).toEqual(['Dinheiro', 'Fiado']);
  });
});
