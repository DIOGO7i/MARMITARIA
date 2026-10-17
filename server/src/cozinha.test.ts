// Impressão automática na cozinha: todo pedido entra na fila e sai impresso uma única vez.
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from './db';
import { createOrder, setOrderStatus, updateOrder } from './services/orders';
import { claimPrint, pendingPrints, reprint } from './services/kitchen';
import { localNow } from './money';
import type { Ctx } from './services/common';

const D = localNow('America/Sao_Paulo').date;
let ctx: Ctx;
beforeEach(() => { ctx = { db: openDb(':memory:'), userId: null, role: 'owner' }; });
const input = (over: any = {}) => ({
  orderDate: D, orderTime: '12:00', source: 'whatsapp' as const, deliveryType: 'retirada' as const,
  items: [{ size: '450 g', qty: 2, unitPriceCents: 1400, notes: 'sem salada' }], deliveryFeeCents: 0, deliveryCostCents: 0, discountCents: 0, paymentStatus: 'pendente' as const, ...over,
});
const printAll = () => pendingPrints(ctx).map((j) => ({ kind: j.kind, number: j.order.number, ok: claimPrint(ctx, j.id).ok }));

describe('impressão na cozinha', () => {
  it('pedido novo entra na fila com tudo que a cozinha precisa', () => {
    const o = createOrder(ctx, input());
    const q = pendingPrints(ctx);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: 'novo', order: { number: o.number, items: [{ qty: 2, size: '450 g', notes: 'sem salada' }] } });
  });

  it('imprime uma vez só, mesmo com duas telas da cozinha abertas', () => {
    createOrder(ctx, input());
    const [j] = pendingPrints(ctx);
    expect(claimPrint(ctx, j.id).ok).toBe(true);
    expect(claimPrint(ctx, j.id).ok).toBe(false);
    expect(pendingPrints(ctx)).toHaveLength(0);
  });

  it('pedido duplicado (clique duplo) não imprime duas vezes', () => {
    createOrder(ctx, input({ idempotencyKey: 'k1' }));
    createOrder(ctx, input({ idempotencyKey: 'k1' }));
    expect(pendingPrints(ctx)).toHaveLength(1);
  });

  it('alterado e cancelado depois de impresso saem como aviso; antes de imprimir não duplicam', () => {
    const o = createOrder(ctx, input());
    updateOrder(ctx, o.id, input({ items: [{ size: '450 g', qty: 3, unitPriceCents: 1400 }] }));
    expect(pendingPrints(ctx)).toHaveLength(1);            // ainda não tinha impresso: sai uma só, já atualizada
    expect(printAll()).toEqual([{ kind: 'novo', number: o.number, ok: true }]);
    updateOrder(ctx, o.id, input({ items: [{ size: '450 g', qty: 4, unitPriceCents: 1400 }] }));
    setOrderStatus(ctx, o.id, 'cancelado', { reason: 'cliente desistiu' });
    expect(printAll().map((x) => x.kind)).toEqual(['cancelado']); // a alteração pendente vira só o aviso de cancelado
    setOrderStatus(ctx, o.id, 'pendente');
    expect(printAll().map((x) => x.kind)).toEqual(['reaberto']);
  });

  it('cancelado antes de imprimir simplesmente sai da fila', () => {
    const o = createOrder(ctx, input());
    setOrderStatus(ctx, o.id, 'cancelado', { reason: 'engano' });
    expect(pendingPrints(ctx)).toHaveLength(0);
  });

  it('reimprimir e desligar a impressão automática', () => {
    const o = createOrder(ctx, input());
    printAll();
    reprint(ctx, o.id);
    expect(printAll().map((x) => x.kind)).toEqual(['reimpressao']);
    ctx.db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('kitchenPrint', ?)").run(JSON.stringify({ enabled: false, paper: '80', copies: 1, printEdits: true, printCancels: true, showPrices: true }));
    createOrder(ctx, input());
    expect(pendingPrints(ctx)).toHaveLength(0);
  });

  it('não imprime pedido velho esquecido na fila (abriu a tela no dia seguinte)', () => {
    createOrder(ctx, input());
    ctx.db.prepare("UPDATE print_jobs SET created_at = '2020-01-01T10:00:00.000Z'").run();
    expect(pendingPrints(ctx)).toHaveLength(0);
  });
});
