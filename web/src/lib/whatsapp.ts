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

export interface MenuPart { label: string; value: string; swaps: string[] }
export interface DayMenuOption { name: string; description: string; sizes: string[]; soldOut?: boolean; parts?: MenuPart[]; carnes?: number; guarnicoes?: number }
/** Carnes e guarnições do dia (botões no pedido). */
export interface DayItem { name: string; soldOut: boolean }
export interface DayItems { carnes: DayItem[]; guarnicoes: DayItem[] }
export const EMPTY_ITEMS: DayItems = { carnes: [], guarnicoes: [] };

const qtd = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
/** "Arroz e feijão + 1 carne + 2 guarnições" */
export function ruleText(o: Pick<DayMenuOption, 'carnes' | 'guarnicoes'>, base = '') {
  return [base.trim(), o.carnes ? qtd(o.carnes, 'carne', 'carnes') : '', o.guarnicoes ? qtd(o.guarnicoes, 'guarnição', 'guarnições') : ''].filter(Boolean).join(' + ');
}

/** "Carne" + [Almôndegas, Omelete] → "Carne: pode trocar por Almôndegas ou Omelete" */
export function swapLine(p: MenuPart) {
  const list = p.swaps.length > 1 ? `${p.swaps.slice(0, -1).join(', ')} ou ${p.swaps[p.swaps.length - 1]}` : p.swaps[0];
  return `${p.label.trim() || p.value.trim()}: pode trocar por ${list}`;
}
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
    for (const p of (o.parts ?? []).filter((x) => x.swaps.length)) lines.push(`↪ ${swapLine(p)}`);
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
