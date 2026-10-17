import { money } from './format';
import type { Settings } from './context';

/** Telefone brasileiro em formato internacional para o link do WhatsApp (ou null se não der para usar). */
export function waPhone(raw: string | null | undefined): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = '55' + d;           // DDD + número
  if (d.length === 8 || d.length === 9) return null;              // sem DDD: não dá para saber
  return d.length >= 12 && d.length <= 13 ? d : null;
}

export function fillTemplate(tpl: string, o: any, settings: Settings) {
  const first = String(o.customerName ?? '').trim().split(/\s+/)[0] || 'cliente';
  const itens = (o.items ?? []).map((i: any) => `${i.qty}x ${i.size}${i.option ? ` (${i.option})` : ''}`).join(', ');
  const prev = o.expectedAt ? o.expectedAt.slice(11, 16) : '';
  return tpl
    .replace(/\{nome\}/g, first)
    .replace(/\{numero\}/g, String(o.number))
    .replace(/\{total\}/g, money(o.totalCents))
    .replace(/\{itens\}/g, itens)
    .replace(/\{previsao\}/g, prev)
    .replace(/\{estabelecimento\}/g, settings.establishment.name);
}

export function waLink(phone: string, text: string) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export const WA_LABELS: Record<string, string> = {
  pendente: 'Pedido recebido', em_preparo: 'Em preparo', pronto: 'Pronto para retirar',
  saiu_para_entrega: 'Saiu para entrega', entregue: 'Agradecimento', cancelado: 'Pedido cancelado',
};

export interface DayMenuOption { name: string; description: string; sizes: string[]; soldOut?: boolean }
export interface SwapGroup { title: string; items: string[] }

/** "terça-feira, 13/10" */
export function weekdayBR(date: string) {
  const d = new Date(date + 'T12:00:00Z');
  const wd = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(d);
  return `${wd}, ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** Texto do cardápio do dia para mandar no WhatsApp (status, grupo ou clientes). Opções esgotadas ficam de fora. */
export function menuText(options: DayMenuOption[], settings: Settings, date: string, today: string, swaps: SwapGroup[] = []) {
  const when = date === today ? 'de hoje' : `de ${weekdayBR(date)}`;
  const lines = [`🍱 *Cardápio ${when}*${date === today ? ` — ${weekdayBR(date)}` : ''}`, ''];
  for (const o of options.filter((x) => !x.soldOut && x.name.trim())) {
    lines.push(`*${o.name}*`);
    if (o.description.trim()) lines.push(o.description.trim());
    const sz = settings.sizes.filter((s) => !o.sizes.length || o.sizes.includes(s.name));
    lines.push(sz.map((s) => `${s.name} ${money(s.priceCents)}`).join(' · '));
    lines.push('');
  }
  for (const g of swaps.filter((x) => x.items.length)) {
    lines.push(`*${g.title}:*`);
    lines.push(g.items.join(', '));
    lines.push('');
  }
  const e = settings.establishment;
  if (e.phone) lines.push(`📲 Peça pelo WhatsApp: ${e.phone}`);
  if (e.hours) lines.push(`🕒 ${e.hours}`);
  lines.push(`— ${e.name}`);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Abre o WhatsApp para escolher para quem mandar (contato, grupo ou status). */
export const waShare = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
