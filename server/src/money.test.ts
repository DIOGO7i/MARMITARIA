import { describe, it, expect } from 'vitest';
import { calcOrderTotals, calcPurchaseTotals, paymentStatus, isLate, localNow, ValidationError } from './money';

describe('pedido', () => {
  it('total = subtotal + frete - desconto', () => {
    const r = calcOrderTotals([{ qty: 2, unitPriceCents: 1800 }, { qty: 1, unitPriceCents: 2200 }], 500, 300);
    expect(r.subtotalCents).toBe(5800);
    expect(r.totalCents).toBe(6000);
  });
  it('rejeita quantidade inválida', () => {
    expect(() => calcOrderTotals([{ qty: 0, unitPriceCents: 100 }], 0, 0)).toThrow(ValidationError);
    expect(() => calcOrderTotals([{ qty: 1.5, unitPriceCents: 100 }], 0, 0)).toThrow(ValidationError);
  });
  it('rejeita total negativo', () => {
    expect(() => calcOrderTotals([{ qty: 1, unitPriceCents: 1000 }], 0, 1500)).toThrow(/negativo/);
  });
  it('sem lista de itens é inválido', () => {
    expect(() => calcOrderTotals([], 0, 0)).toThrow(ValidationError);
  });
  it('evita erro de ponto flutuante (0,1 + 0,2)', () => {
    const r = calcOrderTotals([{ qty: 1, unitPriceCents: 10 }, { qty: 1, unitPriceCents: 20 }], 0, 0);
    expect(r.totalCents).toBe(30);
  });
});

describe('compra', () => {
  it('10 kg de arroz por R$ 60,00 => R$ 6,00/kg', () => {
    const r = calcPurchaseTotals([{ qtyMilli: 10000, totalCents: 6000 }], 0, 0);
    expect(r.lines[0].unitCostCents).toBe(600);
    expect(r.totalCents).toBe(6000);
  });
  it('deriva total a partir do valor unitário com quantidade fracionada', () => {
    const r = calcPurchaseTotals([{ qtyMilli: 2500, unitCostCents: 1000 }], 0, 0);
    expect(r.lines[0].totalCents).toBe(2500);
  });
  it('aplica frete e desconto', () => {
    const r = calcPurchaseTotals([{ qtyMilli: 1000, unitCostCents: 1000 }, { qtyMilli: 2000, unitCostCents: 500 }], 200, 700);
    expect(r.itemsTotalCents).toBe(2000);
    expect(r.totalCents).toBe(2500);
  });
  it('exige valor unitário ou total', () => {
    expect(() => calcPurchaseTotals([{ qtyMilli: 1000 }], 0, 0)).toThrow(ValidationError);
  });
  it('rejeita quantidade zero e total negativo', () => {
    expect(() => calcPurchaseTotals([{ qtyMilli: 0, unitCostCents: 100 }], 0, 0)).toThrow(ValidationError);
    expect(() => calcPurchaseTotals([{ qtyMilli: 1000, unitCostCents: 100 }], 500, 0)).toThrow(/negativo/);
  });
});

describe('status de pagamento', () => {
  it('pendente / parcial / pago', () => {
    expect(paymentStatus(1000, 0)).toBe('pendente');
    expect(paymentStatus(1000, 400)).toBe('parcial');
    expect(paymentStatus(1000, 1000)).toBe('pago');
  });
});

describe('atraso', () => {
  it('atrasado só se passou do previsto e não entregue/cancelado', () => {
    const now = '2026-10-12T12:30';
    expect(isLate({ status: 'pendente', expectedAt: '2026-10-12T12:00' }, now)).toBe(true);
    expect(isLate({ status: 'entregue', expectedAt: '2026-10-12T12:00' }, now)).toBe(false);
    expect(isLate({ status: 'cancelado', expectedAt: '2026-10-12T12:00' }, now)).toBe(false);
    expect(isLate({ status: 'em_preparo', expectedAt: '2026-10-12T13:00' }, now)).toBe(false);
    expect(isLate({ status: 'pendente', expectedAt: null }, now)).toBe(false);
  });
});

describe('fuso horário', () => {
  it('converte para America/Sao_Paulo', () => {
    const r = localNow('America/Sao_Paulo', new Date('2026-10-12T02:30:00Z'));
    expect(r.date).toBe('2026-10-11');
    expect(r.time).toBe('23:30');
  });
});
