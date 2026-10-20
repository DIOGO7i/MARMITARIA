// Impressão pela impressora térmica Bluetooth ligada ao celular (ex.: "5808 Printer", 58 mm),
// através do app RawBT (Android, grátis). O sistema monta a comanda em texto com comandos
// ESC/POS (negrito, letra grande, centralizar) e entrega para o RawBT, que manda pela Bluetooth.
// A escolha vale só para o aparelho onde foi ligada (fica guardada nele).
import { api } from './api';
import { money } from './format';
import type { Settings } from './context';
import type { TicketKind } from './ticket';
import { choiceLines } from './choices';
import { getRawbtFormat, rawbtUrl, SELECT_CP860 } from './escpos';

const KEY = 'marmitaria.impressora';
export type DeviceMode = 'nenhuma' | 'bluetooth';

export function getDeviceMode(): DeviceMode {
  try { return localStorage.getItem(KEY) === 'bluetooth' ? 'bluetooth' : 'nenhuma'; } catch { return 'nenhuma'; }
}
export function setDeviceMode(m: DeviceMode) {
  try { localStorage.setItem(KEY, m); } catch { /* navegador sem armazenamento */ }
}
export const isAndroid = () => /android/i.test(navigator.userAgent);

const ESC = '\x1b', GS = '\x1d';
const INIT = ESC + '@';
const CENTER = ESC + 'a\x01', LEFT = ESC + 'a\x00';
const BOLD = ESC + 'E\x01', NOBOLD = ESC + 'E\x00';
const BIG = GS + '!\x11', TALL = GS + '!\x01', NORMAL = GS + '!\x00';

const BANNER: Record<TicketKind, string | null> = {
  novo: null, alterado: 'PEDIDO ALTERADO', cancelado: 'CANCELADO - NAO FAZER', reaberto: 'PEDIDO REABERTO', reimpressao: '2a VIA', teste: 'TESTE DE IMPRESSAO',
};

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Quebra o texto em linhas de no máximo `cols` caracteres, sem cortar palavras. */
export function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > cols) { if (line) { out.push(line); line = ''; } out.push(w.slice(0, cols)); w = w.slice(cols); }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= cols) line += ' ' + w;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

/** Comanda em texto para impressora térmica. 58 mm = 32 colunas; 80 mm = 48 colunas. */
export function ticketEscPos(o: any, kindIn: TicketKind, settings: Settings): string {
  const cfg: any = settings.kitchenPrint ?? { paper: '58', showPrices: true, copies: 1 };
  const cols = cfg.paper === '80' ? 48 : 32;
  const half = Math.floor(cols / 2); // letra grande ocupa o dobro da largura
  const kind: TicketKind = o.status === 'cancelado' ? 'cancelado' : kindIn;
  const entrega = o.deliveryType === 'entrega';
  const dash = '-'.repeat(cols) + '\n';
  const L: string[] = [];
  const big = (t: string) => L.push(BIG + BOLD + wrap(t, half).join('\n') + '\n' + NOBOLD + NORMAL);
  const tall = (t: string, width = cols) => L.push(TALL + BOLD + wrap(t, width).join('\n') + '\n' + NOBOLD + NORMAL);
  const text = (t: string) => L.push(wrap(t, cols).join('\n') + '\n');

  L.push(INIT + SELECT_CP860 + CENTER);
  const banner = BANNER[kind];
  if (banner) { L.push(BOLD + '*'.repeat(cols) + '\n'); tall(banner); L.push(BOLD + '*'.repeat(cols) + '\n' + NOBOLD); }
  big(`#${o.number}`);
  const prev = o.expectedAt ? String(o.expectedAt).slice(11, 16) : '';
  text(`${o.orderTime ?? ''} - ${o.source === 'whatsapp' ? 'WhatsApp' : 'Balcao'}${prev ? ` - para as ${prev}` : ''}`);
  big(entrega ? 'ENTREGA' : 'RETIRADA');
  if (o.customerName) tall(o.customerName);
  L.push(LEFT + dash);

  let count = 0;
  for (const i of o.items ?? []) {
    count += Number(i.qty || 0);
    tall(`${i.qty}x ${i.size}${i.option ? ` - ${i.option}` : ''}`);
    // marmita montada por botões: carne e guarnições em letra alta, uma linha cada; senão, a descrição da opção
    const ch = choiceLines(i.choices);
    if (ch.length) for (const l of ch) tall(l.toUpperCase());
    else if (i.optionDescription) text(i.optionDescription);
    // cada troca/observação numa linha: a cozinha lê de longe
    for (const n of String(i.notes ?? '').split(/\s*;\s*/).filter(Boolean)) tall(`>> ${n.toUpperCase()}`);
    L.push('\n');
  }
  L.push(ESC + 'a\x02' + `${count} marmita${count === 1 ? '' : 's'}\n` + LEFT);
  if (o.notes) { L.push(dash); tall(`OBS: ${String(o.notes).toUpperCase()}`); }
  if (entrega) {
    L.push(dash);
    L.push(BOLD); text(o.address ?? ''); if (o.neighborhood) text(o.neighborhood); L.push(NOBOLD);
    if (o.customerPhone) text(`Tel. ${o.customerPhone}`);
  }
  const aberto = (o.totalCents ?? 0) - (o.paidCents ?? 0);
  if (cfg.showPrices && o.status !== 'cancelado') {
    L.push(dash + CENTER);
    if (aberto <= 0) tall(`PAGO${o.paymentMethod ? ` - ${o.paymentMethod}` : ''}`);
    else { tall(`${entrega ? 'COBRAR NA ENTREGA' : 'COBRAR'} ${money(aberto)}`); if (o.paymentMethod) text(o.paymentMethod); }
    L.push(LEFT);
  }
  L.push(CENTER + `\n${settings.establishment?.name ?? ''}\nimpresso ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}\n` + LEFT);
  L.push('\n\n\n\n'); // espaço para destacar o papel (a 5808 não tem guilhotina)
  let one = L.join('').replace(/ /g, ' ');
  if (cfg.noAccents) one = plain(one);
  return Array.from({ length: Math.max(1, Math.min(3, cfg.copies ?? 1)) }, () => one).join('');
}

/** Entrega o texto para o RawBT imprimir. Precisa ser chamado logo depois de um toque na tela. */
export function sendToRawBT(data: string) {
  // O RawBT só entende a comanda em base64 (texto direto ele ignora e imprime só o aviso dele)
  const url = rawbtUrl(data, getRawbtFormat());
  const hook = (window as any).__rawbtHook; // usado só nos testes automáticos
  if (typeof hook === 'function') hook(url); else window.location.href = url;
}

/**
 * Imprime agora, pela Bluetooth deste celular, tudo o que estiver na fila da cozinha
 * (pedido novo, alterado, cancelado, reaberto, 2ª via), numa tira só.
 * Não faz nada se este aparelho não estiver marcado como "imprime pela Bluetooth".
 * Devolve quantas comandas foram mandadas.
 */
export async function flushBluetooth(settings: Settings): Promise<number> {
  if (getDeviceMode() !== 'bluetooth') return 0;
  const jobs = await api<{ id: number; kind: TicketKind; order: any }[]>('GET', '/kitchen/queue');
  const parts: string[] = [];
  for (const j of jobs) {
    const c = await api<{ ok: boolean }>('POST', `/kitchen/jobs/${j.id}/claim`);
    if (c.ok) parts.push(ticketEscPos(j.order, j.kind, settings));
  }
  if (parts.length) sendToRawBT(parts.join(''));
  return parts.length;
}

/** Igual a flushBluetooth, mas nunca quebra o que a pessoa estava fazendo. */
export function flushBluetoothQuiet(settings: Settings | null | undefined) {
  if (!settings || getDeviceMode() !== 'bluetooth') return;
  flushBluetooth(settings).catch(() => { /* fica na fila e sai no próximo */ });
}

function ticketTest(settings: Settings) {
  return ticketEscPos({
    number: 0, orderTime: new Date().toTimeString().slice(0, 5), source: 'presencial', deliveryType: 'entrega', customerName: 'Teste da impressora',
    address: 'Rua das Flores, 123 - ap. 4', neighborhood: 'Centro', customerPhone: '(11) 98888-7777',
    items: [{ qty: 2, size: '650 g', option: 'Opção 2', optionDescription: 'Arroz e feijão, Frango empanado, 2x Purê', choices: { carnes: ['Frango empanado'], guarnicoes: ['Purê', 'Purê'] }, notes: 'sem cebola' }],
    totalCents: 3500, paidCents: 0, paymentMethod: 'Pix', notes: 'Acentos: ação, pão, café, maçã',
  }, 'teste', settings);
}
export function testBluetooth(settings: Settings) { sendToRawBT(ticketTest(settings)); }

/** Testes para descobrir qual jeito de mandar funciona com o RawBT e a impressora deste celular. */
export function diagnoseRawBT(kind: 'A' | 'B' | 'C' | 'D', settings: Settings) {
  const plain = `TESTE ${kind}\nSe esta linha saiu, o teste ${kind} funciona.\nAcentos: acao pao cafe\n\n\n\n`;
  const send = (u: string) => { const hook = (window as any).__rawbtHook; if (typeof hook === 'function') hook(u); else window.location.href = u; };
  const tail = '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;';
  if (kind === 'A') send(`intent:${encodeURI(plain)}${tail}`);                // texto simples, jeito do exemplo oficial
  if (kind === 'B') send(`intent:base64,${btoa(plain)}${tail}`);              // texto simples em base64
  if (kind === 'C') send(rawbtUrl(ticketTest(settings), 'base64'));             // comanda completa em base64
  if (kind === 'D') send(rawbtUrl(ticketTest(settings), 'texto'));              // comanda completa como texto
}
