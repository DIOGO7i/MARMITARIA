// Comanda da cozinha (impressora térmica de 80 mm ou 58 mm). HTML simples, letras grandes e em negrito,
// só o que a cozinheira precisa: número, retirada/entrega, marmitas, observações e o que cobrar.
import { money } from './format';
import type { Settings } from './context';
import { choiceLines } from './choices';

export type TicketKind = 'novo' | 'alterado' | 'cancelado' | 'reaberto' | 'reimpressao' | 'teste';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const BANNER: Record<TicketKind, string | null> = {
  novo: null,
  alterado: 'PEDIDO ALTERADO',
  cancelado: 'CANCELADO — NÃO FAZER',
  reaberto: 'PEDIDO REABERTO',
  reimpressao: '2ª VIA',
  teste: 'TESTE DE IMPRESSÃO',
};

export function ticketBody(o: any, kindIn: TicketKind, settings: Settings) {
  // pedido cancelado sempre sai avisando, até numa 2ª via
  const kind: TicketKind = o.status === 'cancelado' ? 'cancelado' : kindIn;
  const cfg = settings.kitchenPrint ?? { showPrices: true };
  const banner = BANNER[kind];
  const entrega = o.deliveryType === 'entrega';
  const hora = o.orderTime ?? '';
  const prev = o.expectedAt ? String(o.expectedAt).slice(11, 16) : '';
  const totalMarmitas = (o.items ?? []).reduce((a: number, i: any) => a + Number(i.qty || 0), 0);
  const aberto = (o.totalCents ?? 0) - (o.paidCents ?? 0);
  const pagamento = !cfg.showPrices ? ''
    : o.status === 'cancelado' ? ''
    : aberto <= 0 ? `<div class="pay ok">PAGO${o.paymentMethod ? ` · ${esc(o.paymentMethod)}` : ''}</div>`
    : `<div class="pay due">${entrega ? 'COBRAR NA ENTREGA' : 'COBRAR'} ${esc(money(aberto))}${o.paymentMethod ? `<br><span>${esc(o.paymentMethod)}</span>` : ''}</div>`;
  return `
<section class="t">
  ${banner ? `<div class="banner${kind === 'cancelado' ? ' big' : ''}">${esc(banner)}</div>` : ''}
  <div class="num">#${esc(o.number)}</div>
  <div class="meta">${esc(hora)}${o.source === 'whatsapp' ? ' · WhatsApp' : ' · Balcão'}${prev ? ` · para as <b>${esc(prev)}</b>` : ''}</div>
  <div class="type">${entrega ? 'ENTREGA' : 'RETIRADA'}</div>
  ${o.customerName ? `<div class="cust">${esc(o.customerName)}</div>` : ''}
  <hr>
  ${(o.items ?? []).map((i: any) => `
  <div class="item">
    <div class="line"><span class="q">${esc(i.qty)}×</span> ${esc(i.size)}${i.option ? ` <span class="opt">${esc(i.option)}</span>` : ''}</div>
    ${choiceLines(i.choices).length ? choiceLines(i.choices).map((l) => `<div class="choice">${esc(l)}</div>`).join('') : i.optionDescription ? `<div class="desc">${esc(i.optionDescription)}</div>` : ''}
    ${i.notes ? String(i.notes).split(/\s*;\s*/).filter(Boolean).map((n: string) => `<div class="note">» ${esc(n)}</div>`).join('') : ''}
  </div>`).join('')}
  <div class="count">${totalMarmitas} marmita${totalMarmitas === 1 ? '' : 's'}</div>
  ${o.notes ? `<hr><div class="note">OBS: ${esc(o.notes)}</div>` : ''}
  ${entrega ? `<hr><div class="addr">${esc(o.address)}${o.neighborhood ? `<br>${esc(o.neighborhood)}` : ''}</div>${o.customerPhone ? `<div class="small">Tel. ${esc(o.customerPhone)}</div>` : ''}` : ''}
  ${pagamento ? `<hr>${pagamento}` : ''}
  <div class="foot">${esc(settings.establishment.name)} · impresso ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
</section>`;
}

export function ticketHtml(o: any, kind: TicketKind, settings: Settings) {
  const cfg = settings.kitchenPrint ?? { paper: '80', copies: 1 };
  const w = cfg.paper === '58' ? 48 : 72; // área útil em mm
  const body = Array.from({ length: Math.max(1, Math.min(3, cfg.copies ?? 1)) }, () => ticketBody(o, kind, settings)).join('');
  const k = (cfg.paper === '58' ? 0.8 : 1) * ((cfg as any).small ? 0.82 : 1);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido #${esc(o.number)}</title><style>
@page { size: ${cfg.paper === '58' ? 58 : 80}mm 200mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { width: ${w}mm; margin: 0 auto !important; padding: 0 1mm; font-family: Arial, Helvetica, sans-serif; font-size: ${13 * k}pt; line-height: 1.25; }
.t { padding: 2mm 0 5mm; break-inside: avoid; }
.t + .t { break-before: page; page-break-before: always; }
.banner { border: 2px solid #000; text-align: center; font-weight: 900; font-size: ${15 * k}pt; padding: 1.5mm; margin-bottom: 2mm; }
.banner.big { background: #000; color: #fff; font-size: ${18 * k}pt; }
.num { font-size: ${40 * k}pt; font-weight: 900; line-height: 1; text-align: center; margin-top: 1mm; }
.meta { text-align: center; font-size: ${11 * k}pt; margin-top: 1mm; }
.type { margin: 2mm auto 0; text-align: center; background: #000; color: #fff; font-weight: 900; font-size: ${15 * k}pt; letter-spacing: .5pt; padding: 1mm 0; }
.cust { text-align: center; font-weight: 700; font-size: ${14 * k}pt; margin-top: 1.5mm; }
hr { border: 0; border-top: 1.5px dashed #000; margin: 2.5mm 0; }
.item { margin-bottom: 2.5mm; }
.line { font-size: ${16 * k}pt; font-weight: 900; }
.q { font-size: ${19 * k}pt; }
.opt { border: 1.5px solid #000; padding: 0 1mm; font-size: ${13 * k}pt; white-space: nowrap; }
.desc { font-size: ${11 * k}pt; margin-top: .5mm; }
.choice { font-weight: 800; font-size: ${13 * k}pt; margin-top: .5mm; }
.note { font-weight: 900; font-size: ${14 * k}pt; text-transform: uppercase; margin-top: .8mm; }
.count { text-align: right; font-size: ${11 * k}pt; font-weight: 700; }
.addr { font-size: ${12 * k}pt; font-weight: 700; }
.small { font-size: ${11 * k}pt; }
.pay { text-align: center; font-weight: 900; font-size: ${15 * k}pt; padding: 1.5mm; }
.pay.due { border: 2px solid #000; }
.pay span { font-size: ${11 * k}pt; font-weight: 700; }
.foot { text-align: center; font-size: ${8.5 * k}pt; margin-top: 3mm; }

</style></head><body>${body}</body></html>`;
}

/**
 * Imprime a comanda num quadro escondido. O tamanho da folha é medido pelo próprio conteúdo
 * (largura do rolo × altura da comanda): assim a impressora térmica corta no tamanho certo,
 * sem sair uma tira enorme de papel em branco, e numa impressora comum sai pequeno no topo da folha.
 * Com o navegador aberto pelo atalho da cozinha (--kiosk-printing), não aparece janela nenhuma.
 */
export function printTicket(html: string, paper: '80' | '58' = '80') {
  return new Promise<void>((resolve) => {
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;left:-10000px;top:0;width:420px;height:200px;border:0;';
    let done = false;
    const finish = () => { if (done) return; done = true; setTimeout(() => { f.remove(); resolve(); }, 500); };
    f.onload = () => {
      const w = f.contentWindow!; const doc = f.contentDocument!;
      const first = doc.querySelector('.t') as HTMLElement | null;
      const px = first ? first.getBoundingClientRect().height : doc.documentElement.scrollHeight;
      const mm = Math.ceil((px * 25.4) / 96) + 2; // 96 px = 1 polegada
      const st = doc.createElement('style');
      st.textContent = `@page { size: ${paper === '58' ? 58 : 80}mm ${mm}mm; margin: 0; }`;
      doc.head.appendChild(st);
      w.addEventListener('afterprint', finish);
      setTimeout(() => { try { w.focus(); w.print(); } catch { /* sem impressora */ } setTimeout(finish, 2500); }, 150);
    };
    f.srcdoc = html;
    document.body.appendChild(f);
  });
}
