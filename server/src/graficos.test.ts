// Fatias dos gráficos de pizza do Relatório: cada pizza tem que somar o total certo.
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from './db';
import { summary } from './services/reports';
import { createOrder, setOrderStatus } from './services/orders';
import { createExpense } from './services/expenses';
import { localNow } from './money';
import type { Ctx } from './services/common';

let ctx: Ctx;
const D = localNow('America/Sao_Paulo').date;
beforeEach(() => { ctx = { db: openDb(':memory:'), userId: null, role: 'owner' }; });
const pedido = (over: any = {}) => createOrder(ctx, {
  orderDate: D, orderTime: '12:00', source: 'presencial', deliveryType: 'retirada',
  items: [{ size: '450 g', qty: 2, unitPriceCents: 1400 }], deliveryFeeCents: 0, deliveryCostCents: 0, discountCents: 0,
  paymentStatus: 'pago', paymentMethod: 'Dinheiro', ...over,
} as any);
const gasto = (category: string, amountCents: number) => createExpense(ctx, { description: category, category, expenseDate: D, amountCents, status: 'pago', paymentMethod: 'Pix' } as any);

describe('gráficos de pizza', () => {
  it('formas de pagamento somam o recebido; canceladas e estornos ficam de fora', () => {
    pedido();
    pedido({ paymentMethod: 'Pix', items: [{ size: '650 g', qty: 1, unitPriceCents: 1600 }] });
    const c = pedido({ paymentMethod: 'Cartão de crédito' });
    setOrderStatus(ctx, c.id, 'cancelado', { reason: 'teste' });
    const s = summary(ctx, D, D);
    expect(s.charts.receivedByMethod).toEqual([{ label: 'Dinheiro', cents: 2800 }, { label: 'Pix', cents: 1600 }]);
    expect(s.charts.receivedByMethod.reduce((a, r) => a + r.cents, 0)).toBe(s.receivedCents);
  });

  it('marmitas por tamanho, por opção e retirada x entrega (sem canceladas)', () => {
    pedido({ items: [{ size: '450 g', qty: 2, unitPriceCents: 1400, option: 'Opção 1' }, { size: '650 g', qty: 1, unitPriceCents: 1600, option: 'Opção 2' }] });
    pedido({ deliveryType: 'entrega', address: 'Rua A, 1', items: [{ size: '450 g', qty: 3, unitPriceCents: 1400, option: 'Opção 1' }] });
    const s = summary(ctx, D, D);
    expect(s.charts.marmitasBySize).toEqual([{ label: '450 g', qty: 5 }, { label: '650 g', qty: 1 }]);
    expect(s.charts.marmitasByOption).toEqual([{ label: 'Opção 1', qty: 5 }, { label: 'Opção 2', qty: 1 }]);
    expect(s.charts.marmitasBySize.reduce((a, r) => a + r.qty, 0)).toBe(s.marmitasTotal);
    expect(s.charts.deliveryTypes).toEqual([{ label: 'Retirada no local', qty: 1, cents: 4400 }, { label: 'Entrega', qty: 1, cents: 4200 }]);
  });

  it('para onde vai o dinheiro: despesas por categoria e entregadores sem contar duas vezes', () => {
    gasto('Gás', 12000); gasto('Aluguel', 150000); gasto('Pagamento a entregadores', 5000);
    let s = summary(ctx, D, D);
    expect(s.charts.spending).toEqual([{ label: 'Aluguel', cents: 150000 }, { label: 'Gás', cents: 12000 }, { label: 'Entregadores', cents: 5000 }]);
    // com custo de entregador informado nos pedidos, vale o dos pedidos (não soma os dois)
    pedido({ deliveryType: 'entrega', address: 'Rua A, 1', deliveryCostCents: 700 });
    s = summary(ctx, D, D);
    expect(s.charts.spending.find((x) => x.label === 'Entregadores')!.cents).toBe(700);
  });
});
