const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (cents: number | null | undefined) => brl.format((cents ?? 0) / 100);

export const qty = (milli: number) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(milli / 1000);

/** '2026-10-12' -> '12/10/2026' */
export const dateBR = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
/** '2026-10-12T14:30' -> '12/10/2026 14:30' */
export const dateTimeBR = (d: string | null | undefined) => (d ? `${dateBR(d)} ${d.slice(11, 16)}` : '—');
/** Instante UTC ISO -> data/hora local de exibição */
export const instantBR = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** "1.234,56" | "12,5" | "12.5" -> centavos (inteiro) ou null se inválido */
export function parseCents(s: string): number | null {
  const t = s.trim().replace(/[R$\s]/g, '');
  if (!t) return null;
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^-?\d+(\.\d{1,2})?$/.test(norm)) return null;
  return Math.round(Number(norm) * 100);
}
/** Quantidade decimal (até 3 casas) -> milésimos */
export function parseMilli(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^\d+(\.\d{1,3})?$/.test(norm)) return null;
  return Math.round(Number(norm) * 1000);
}
export const centsToInput = (c: number) => (c / 100).toFixed(2).replace('.', ',');
export const milliToInput = (m: number) => String(m / 1000).replace('.', ',');

export const ORDER_STATUS: Record<string, { label: string; cls: string; icon: string }> = {
  pendente: { label: 'Pendente', cls: 'bg-amber-100 text-amber-800', icon: '⏳' },
  em_preparo: { label: 'Em preparo', cls: 'bg-blue-100 text-blue-800', icon: '🍳' },
  pronto: { label: 'Pronto', cls: 'bg-indigo-100 text-indigo-800', icon: '✔' },
  saiu_para_entrega: { label: 'Saiu para entrega', cls: 'bg-purple-100 text-purple-800', icon: '🛵' },
  entregue: { label: 'Entregue / retirado', cls: 'bg-green-100 text-green-800', icon: '✅' },
  cancelado: { label: 'Cancelado', cls: 'bg-slate-200 text-slate-600 line-through', icon: '✖' },
};
/** Caminho do pedido: na retirada não existe "saiu para entrega" e o final é "Retirado". */
export const statusFlow = (deliveryType?: string) =>
  deliveryType === 'retirada' ? ['pendente', 'em_preparo', 'pronto', 'entregue'] : ['pendente', 'em_preparo', 'pronto', 'saiu_para_entrega', 'entregue'];
export function statusInfo(status: string, deliveryType?: string) {
  const base = ORDER_STATUS[status] ?? { label: status, cls: 'bg-slate-100 text-slate-700', icon: '' };
  if (deliveryType === 'retirada') {
    if (status === 'pronto') return { ...base, label: 'Pronto para retirar', icon: '🛍' };
    if (status === 'entregue') return { ...base, label: 'Retirado', icon: '✅' };
  } else if (deliveryType === 'entrega' && status === 'pronto') return { ...base, label: 'Pronto (esperando entregador)' };
  return base;
}
export function nextStatus(status: string, deliveryType?: string) {
  const f = statusFlow(deliveryType); const i = f.indexOf(status);
  return i >= 0 && i < f.length - 1 ? f[i + 1] : null;
}
export const PAY_STATUS: Record<string, { label: string; cls: string }> = {
  pendente: { label: 'A receber', cls: 'bg-amber-100 text-amber-800' },
  parcial: { label: 'Parcial', cls: 'bg-orange-100 text-orange-800' },
  pago: { label: 'Pago', cls: 'bg-green-100 text-green-800' },
};
export const SOURCE: Record<string, string> = { presencial: 'Presencial', whatsapp: 'WhatsApp' };
export const REASON: Record<string, string> = {
  compra: 'Compra', consumo: 'Consumo no preparo', perda: 'Perda / vencimento', descarte: 'Descarte', uso_interno: 'Uso interno',
  ajuste_inventario: 'Ajuste de inventário', outro: 'Outro', cancelamento_compra: 'Cancelamento de compra', saldo_inicial: 'Saldo inicial', estorno_pedido: 'Estorno de pedido',
};

export function csvDownload(filename: string, rows: (string | number)[][]) {
  // Evita "injeção de fórmula" no Excel: texto que começa com = + - @ vira texto puro (valores em R$ e números continuam normais).
  const safe = (t: string) => (/^[=+@\t\r]/.test(t) || (/^-/.test(t) && !/^-\s?(R\$\s?)?[\d.,]+$/.test(t)) ? `'${t}` : t);
  const esc = (v: string | number) => `"${(typeof v === 'number' ? String(v) : safe(String(v))).replace(/"/g, '""')}"`;
  const body = rows.map((r) => r.map(esc).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
export const todayISO = () => new Date().toLocaleDateString('en-CA'); // fallback; o servidor informa a data oficial

/** Valor curto para eixo de gráfico: R$ 950, R$ 1,5 mil, R$ 12 mil */
export const moneyAxis = (reais: number) =>
  'R$ ' + new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(reais);

/** "2× 350 g (Opção 1)" */
export const itemLabel = (i: { qty: number; size: string; option?: string | null }) => `${i.qty}× ${i.size}${i.option ? ` (${i.option})` : ''}`;

export const MIN_PASSWORD = 6; // igual ao servidor
