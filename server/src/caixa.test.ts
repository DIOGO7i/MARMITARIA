// Caixa do dia: as contas da gaveta em situações do dia a dia (troca de forma de pagamento, encomenda, fechamento...).
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from './db';
import { addCashMovement, cashDay, closeCash, openCash, reopenCash } from './services/cash';
import { addOrderPayment, createOrder, reverseOrderPayment, setOrderStatus, updateOrder } from './services/orders';
import { createExpense } from './services/expenses';
import { localNow } from './money';
import type { Ctx } from './services/common';

let ctx: Ctx;
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const D = localNow('America/Sao_Paulo').date;
beforeEach(() => { ctx = { db: openDb(':memory:'), userId: null, role: 'owner' }; });
const pedido = (over: any = {}) => ({
  orderDate: D, orderTime: '12:00', source: 'presencial' as const, deliveryType: 'retirada' as const,
  items: [{ size: '450 g', qty: 1, unitPriceCents: 2000 }], deliveryFeeCents: 0, deliveryCostCents: 0, discountCents: 0,
  paymentStatus: 'pago' as const, paymentMethod: 'Dinheiro', ...over,
});

describe('conta da gaveta', () => {
  it('troco + dinheiro recebido + suprimento − contas em dinheiro − sangria', () => {
    openCash(ctx, D, 5000);
    createOrder(ctx, pedido());                                     // +20,00 dinheiro
    createOrder(ctx, pedido({ paymentMethod: 'Pix' }));             // Pix não entra na gaveta
    createExpense(ctx, { description: 'Gás', category: 'Gás', expenseDate: D, amountCents: 1200, status: 'pago', paymentMethod: 'Dinheiro' } as any); // −12,00
    addCashMovement(ctx, D, 'suprimento', 1000, 'mais troco');      // +10,00
    addCashMovement(ctx, D, 'sangria', 3000, 'depósito');           // −30,00
    const d = cashDay(ctx, D);
    expect(d.expectedCashCents).toBe(5000 + 2000 - 1200 + 1000 - 3000);
    expect(d.totalReceivedCents).toBe(4000);
  });

  it('corrigir a forma de pagamento no pedido muda o caixa (Pix → Dinheiro)', () => {
    openCash(ctx, D, 0);
    const o = createOrder(ctx, pedido({ paymentMethod: 'Pix' }));
    expect(cashDay(ctx, D).cashInCents).toBe(0);
    updateOrder(ctx, o.id, pedido({ paymentMethod: 'Dinheiro' }));
    const d = cashDay(ctx, D);
    expect(d.cashInCents).toBe(2000);
    expect(d.received.find((r: any) => r.method === 'Pix')).toBeUndefined();
  });

  it('recebimento lançado sem escolher a forma usa a forma do pedido', () => {
    openCash(ctx, D, 0);
    const o = createOrder(ctx, pedido({ paymentStatus: 'pendente', paymentMethod: 'Dinheiro' }));
    addOrderPayment(ctx, o.id, { amountCents: 2000 });
    expect(cashDay(ctx, D).cashInCents).toBe(2000);
  });

  it('encomenda para amanhã paga hoje entra no caixa de HOJE', () => {
    openCash(ctx, D, 0);
    createOrder(ctx, pedido({ orderDate: addDays(D, 1) }));
    expect(cashDay(ctx, D).cashInCents).toBe(2000);
    expect(cashDay(ctx, addDays(D, 1)).cashInCents).toBe(0);
  });

  it('pedido de ontem lançado hoje continua no dia de ontem', () => {
    createOrder(ctx, pedido({ orderDate: addDays(D, -1) }));
    expect(cashDay(ctx, addDays(D, -1)).cashInCents).toBe(2000);
  });

  it('"dinheiro" escrito diferente nas Configurações continua contando como dinheiro', () => {
    openCash(ctx, D, 0);
    createOrder(ctx, pedido({ paymentMethod: ' dinheiro ' }));
    createOrder(ctx, pedido({ paymentMethod: 'Dinheiro (espécie)' }));
    const d = cashDay(ctx, D);
    expect(d.cashInCents).toBe(4000);
    expect(d.received.every((r: any) => r.cash)).toBe(true);
  });

  it('estorno não conta como recebimento a mais na contagem', () => {
    openCash(ctx, D, 0);
    const o = createOrder(ctx, pedido());
    const pay = (ctx.db.prepare("SELECT id FROM payments WHERE ref_id = ?").get(o.id) as any).id;
    reverseOrderPayment(ctx, o.id, pay);
    const r = cashDay(ctx, D).received.find((x: any) => x.method === 'Dinheiro')!;
    expect(r).toMatchObject({ totalCents: 0, count: 1 });
  });

  it('pedido cancelado devolve o dinheiro na conta do dia', () => {
    openCash(ctx, D, 1000);
    const o = createOrder(ctx, pedido());
    setOrderStatus(ctx, o.id, 'cancelado', { reason: 'cliente desistiu' });
    expect(cashDay(ctx, D).expectedCashCents).toBe(1000);
  });

  it('avisa o que foi recebido sem forma de pagamento (pode ser dinheiro fora da conta)', () => {
    openCash(ctx, D, 0);
    createOrder(ctx, pedido({ paymentMethod: null }));
    expect(cashDay(ctx, D).unknownMethodCents).toBe(2000);
  });

  it('sangria maior que o dinheiro da gaveta é recusada', () => {
    openCash(ctx, D, 5000);
    expect(() => addCashMovement(ctx, D, 'sangria', 6000, 'banco')).toThrow(/só deveria ter R\$\s?50,00/);
    addCashMovement(ctx, D, 'sangria', 5000, 'banco');
  });

  it('dinheiro lançado depois do fechamento aparece como aviso, sem mudar o fechamento', () => {
    openCash(ctx, D, 0);
    createOrder(ctx, pedido());
    closeCash(ctx, D, { countedCashCents: 2000, leftInDrawerCents: 0 });
    createOrder(ctx, pedido({ items: [{ size: '450 g', qty: 1, unitPriceCents: 1500 }] }));
    const d = cashDay(ctx, D);
    expect(d.expectedCashCents).toBe(2000);
    expect(d.differenceCents).toBe(0);
    expect(d.changedAfterCloseCents).toBe(1500);
    reopenCash(ctx, D);
    expect(cashDay(ctx, D).expectedCashCents).toBe(3500);
    expect(cashDay(ctx, D).changedAfterCloseCents).toBe(0);
  });
});
