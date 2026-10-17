// Cálculos financeiros puros (sem banco de dados). Valores em centavos, quantidades em milésimos.

export class ValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
  }
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

export interface OrderItemInput {
  size: string;
  qty: number;
  unitPriceCents: number;
}

export function calcOrderTotals(
  items: Pick<OrderItemInput, 'qty' | 'unitPriceCents'>[],
  deliveryFeeCents: number,
  discountCents: number,
) {
  if (!items.length) throw new ValidationError('O pedido precisa ter ao menos uma marmita.');
  let subtotal = 0;
  const lines = items.map((it) => {
    if (!isInt(it.qty) || it.qty <= 0) throw new ValidationError('Quantidade de marmitas inválida.');
    if (!isInt(it.unitPriceCents) || it.unitPriceCents < 0) throw new ValidationError('Valor unitário inválido.');
    const total = it.qty * it.unitPriceCents;
    subtotal += total;
    return { ...it, totalCents: total };
  });
  if (!isInt(deliveryFeeCents) || deliveryFeeCents < 0) throw new ValidationError('Frete cobrado inválido.');
  if (!isInt(discountCents) || discountCents < 0) throw new ValidationError('Desconto inválido.');
  const total = subtotal + deliveryFeeCents - discountCents;
  if (total < 0) throw new ValidationError('O desconto não pode deixar o total do pedido negativo.');
  return { lines, subtotalCents: subtotal, totalCents: total };
}

export interface PurchaseItemInput {
  qtyMilli: number;
  unitCostCents?: number | null;
  totalCents?: number | null;
}

/** Aceita valor unitário OU valor total por item e deriva o outro. */
export function calcPurchaseTotals(items: PurchaseItemInput[], discountCents: number, freightCents: number) {
  if (!items.length) throw new ValidationError('A compra precisa ter ao menos um produto.');
  let itemsTotal = 0;
  const lines = items.map((it) => {
    if (!isInt(it.qtyMilli) || it.qtyMilli <= 0) throw new ValidationError('Quantidade comprada inválida.');
    let unit = it.unitCostCents;
    let total = it.totalCents;
    if (isInt(total) && total >= 0 && (unit == null || unit === undefined)) {
      unit = Math.round((total * 1000) / it.qtyMilli);
    } else if (isInt(unit) && unit >= 0) {
      if (!isInt(total)) total = Math.round((it.qtyMilli * unit) / 1000);
    } else {
      throw new ValidationError('Informe o valor unitário ou o valor total de cada produto.');
    }
    itemsTotal += total as number;
    return { qtyMilli: it.qtyMilli, unitCostCents: unit as number, totalCents: total as number };
  });
  if (!isInt(discountCents) || discountCents < 0) throw new ValidationError('Desconto da compra inválido.');
  if (!isInt(freightCents) || freightCents < 0) throw new ValidationError('Frete da compra inválido.');
  const total = itemsTotal + freightCents - discountCents;
  if (total < 0) throw new ValidationError('O desconto não pode deixar o total da compra negativo.');
  return { lines, itemsTotalCents: itemsTotal, totalCents: total };
}

export type PayStatus = 'pendente' | 'parcial' | 'pago';

export function paymentStatus(totalCents: number, paidCents: number): PayStatus {
  if (paidCents <= 0) return totalCents === 0 ? 'pago' : 'pendente';
  if (paidCents >= totalCents) return 'pago';
  return 'parcial';
}

/** Pedido atrasado: passou do horário previsto e não está entregue/cancelado. nowLocal e expectedAt: 'YYYY-MM-DDTHH:MM'. */
export function isLate(
  order: { status: string; expectedAt: string | null },
  nowLocal: string,
): boolean {
  if (!order.expectedAt) return false;
  if (order.status === 'entregue' || order.status === 'cancelado') return false;
  return nowLocal > order.expectedAt;
}

export function localNow(tz: string, at: Date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  const hour = g('hour') === '24' ? '00' : g('hour');
  const date = `${g('year')}-${g('month')}-${g('day')}`;
  const time = `${hour}:${g('minute')}`;
  return { date, time, dateTime: `${date}T${time}` };
}

/** 12345 → "R$ 123,45" (para mensagens de erro). */
export const formatBRL = (cents: number) => {
  const neg = cents < 0; const v = Math.abs(cents);
  const reais = String(Math.floor(v / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '−' : ''}R$ ${reais},${String(v % 100).padStart(2, '0')}`;
};
