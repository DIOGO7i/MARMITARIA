import { useEffect, useRef, useState } from 'react';
import { Download, ImagePlus, Share2, X } from 'lucide-react';
import { useApp } from '../lib/context';
import { money } from '../lib/format';
import type { DayMenuOption, SwapGroup } from '../lib/whatsapp';
import { Button } from './ui';

// Imagem do cardápio do dia, montada a partir do que foi preenchido acima, nas cores e letras da marca.
// Desenhada em <canvas> no próprio celular: não depende de internet nem de programa de edição.

const C = {
  paper: '#FFFFFF',
  ink: '#2A2118',      // títulos e telefone
  body: '#4D4033',     // pratos
  soft: '#8A7A66',     // tamanhos, data, textos de apoio
  brown: '#986400',    // marrom da logo: só nos preços e títulos das trocas
  yellow: '#FDD661',   // amarelo da logo: só um acento
  line: '#ECE6DA',     // linhas finas
};
const DISPLAY = 'Oranienbaum, "Times New Roman", serif';
const TEXT = '"Josefin Sans", "Segoe UI", Arial, sans-serif';
type Format = 'status' | 'feed';
const SIZE: Record<Format, { w: number; h: number }> = { status: { w: 1080, h: 1920 }, feed: { w: 1080, h: 1350 } };
const WEEK = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "Arroz e feijão, Frango empanado, Creme de milho" → uma linha por item (vírgula ou quebra de linha separam). */
const itemsOf = (d: string) => d.split(/\n|,|;/).map((x) => x.trim()).filter(Boolean).map((x) => x[0].toUpperCase() + x.slice(1));

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const words = text.split(/\s+/); const out: string[] = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width <= max || !cur) cur = t; else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}
/** Ajuste automático da foto do prato: um pouco mais de luz, contraste e cor (comida "viva"), puxando para o quente. */
function enhance(img: HTMLImageElement | ImageBitmap, w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  // recorte "cover": preenche o quadro sem deformar
  const iw = img.width, ih = img.height; const s = Math.max(w / iw, h / ih);
  x.drawImage(img, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s);
  const d = x.getImageData(0, 0, w, h); const p = d.data;
  // nível automático: estica o histograma (corta 1% de cada ponta) para fotos escuras/lavadas
  const hist = new Uint32Array(256);
  for (let i = 0; i < p.length; i += 4) hist[(p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) | 0]++;
  const n = p.length / 4; let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) < n * 0.005) lo++;
  acc = 0; while (hi > 0 && (acc += hist[hi]) < n * 0.005) hi--;
  // estica no máximo ~1,4x (foto que já está boa quase não muda)
  lo = Math.min(lo, 40); hi = Math.max(hi, 200);
  const span = Math.max(180, hi - lo);
  const contrast = 1.05, sat = 1.15;
  for (let i = 0; i < p.length; i += 4) {
    let r = ((p[i] - lo) * 255) / span, g = ((p[i + 1] - lo) * 255) / span, b = ((p[i + 2] - lo) * 255) / span;
    r = (r - 128) * contrast + 128 + 6; g = (g - 128) * contrast + 128 + 2; b = (b - 128) * contrast + 128 - 4; // leve calor
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    p[i] = Math.max(0, Math.min(255, l + (r - l) * sat));
    p[i + 1] = Math.max(0, Math.min(255, l + (g - l) * sat));
    p[i + 2] = Math.max(0, Math.min(255, l + (b - l) * sat));
  }
  x.putImageData(d, 0, 0);
  return c;
}

interface Drawn { blob: Blob; url: string }

async function draw(fmt: Format, opts: DayMenuOption[], swaps: SwapGroup[], date: string, sizes: { name: string; priceCents: number }[], est: { name: string; phone: string; hours: string }, logo: HTMLImageElement | null, photo: HTMLImageElement | null): Promise<Drawn> {
  await Promise.all([`400 80px ${DISPLAY}`, `400 40px ${TEXT}`, `600 40px ${TEXT}`].map((f) => document.fonts.load(f).catch(() => null)));
  const { w: W, h: H } = SIZE[fmt];
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  const shown = opts.filter((o) => !o.soldOut && o.name.trim());
  const groups = swaps.filter((g) => g.items.length);
  const d = new Date(date + 'T12:00:00Z');
  const wd = WEEK[d.getUTCDay()];
  const title = wd[0].toUpperCase() + wd.slice(1) + (d.getUTCDay() > 0 && d.getUTCDay() < 6 ? '-feira' : '');
  const sub = `Cardápio de ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
  const M = 96; const inner = W - M * 2;
  const phone = (est.phone || '').split('/')[0].trim();
  const footH = fmt === 'status' ? 250 : 190;
  const photoH = photo ? (fmt === 'status' ? 540 : 380) : 0;

  // Estilo limpo: papel branco, tipografia da marca, linhas finas separando as opções, preço alinhado à direita.
  // Monta tudo numa escala s; se não couber, diminui até caber (nada é cortado).
  const plan = (s: number, paint: boolean, top: number) => {
    let y = top;
    const logoSize = (fmt === 'status' ? 132 : 104) * s;
    if (paint && logo) {
      ctx.save(); ctx.beginPath(); ctx.arc(W / 2, y + logoSize / 2, logoSize / 2, 0, Math.PI * 2); ctx.clip();
      const z = 0.04 * logo.width; ctx.drawImage(logo, z, z, logo.width - 2 * z, logo.height - 2 * z, W / 2 - logoSize / 2, y, logoSize, logoSize); ctx.restore();
    }
    y += logoSize + 44 * s;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = `400 ${128 * s}px ${DISPLAY}`; y += 104 * s;
    if (paint) { ctx.fillStyle = C.ink; ctx.fillText(title, W / 2, y); }
    ctx.font = `400 ${32 * s}px ${TEXT}`; y += 58 * s;
    if (paint) { ctx.fillStyle = C.soft; ctx.fillText(sub, W / 2, y); }
    y += 40 * s;
    if (paint) { ctx.fillStyle = C.yellow; ctx.fillRect(W / 2 - 36 * s, y, 72 * s, 5 * s); }
    y += 72 * s;

    shown.forEach((o, idx) => {
      // montada por partes: cada parte numa linha, com as trocas logo depois ("Frango empanado (ou Almôndegas ou Omelete)")
      const items = o.parts?.length ? o.parts.map((p) => (p.swaps.length ? `${p.value} (ou ${p.swaps.join(' ou ')})` : p.value)).map((x) => x[0].toUpperCase() + x.slice(1)) : itemsOf(o.description || '');
      const sz = sizes.filter((x) => !o.sizes.length || o.sizes.includes(x.name));
      // coluna dos preços (direita)
      ctx.font = `600 ${36 * s}px ${TEXT}`;
      const priceW = Math.max(0, ...sz.map((x) => ctx.measureText(money(x.priceCents)).width));
      ctx.font = `400 ${30 * s}px ${TEXT}`;
      const sizeW = Math.max(0, ...sz.map((x) => ctx.measureText(x.name).width));
      const colW = priceW + sizeW + 22 * s;
      const leftW = inner - colW - 48 * s;
      ctx.font = `400 ${38 * s}px ${TEXT}`;
      const lines = items.flatMap((it) => wrap(ctx, it, leftW));
      const nameH = 66 * s; const lineH = 54 * s;
      const leftH = nameH + 20 * s + lines.length * lineH;
      const rightH = 12 * s + sz.length * 56 * s;
      const h = Math.max(leftH, rightH);
      if (paint) {
        ctx.textAlign = 'left'; ctx.fillStyle = C.ink; ctx.font = `400 ${66 * s}px ${DISPLAY}`; ctx.fillText(o.name, M, y + 56 * s);
        ctx.font = `400 ${38 * s}px ${TEXT}`; ctx.fillStyle = C.body;
        let cy = y + nameH + 20 * s;
        for (const l of lines) { cy += lineH; ctx.fillText(l, M, cy - 14 * s); }
        let py = y + 12 * s;
        for (const x of sz) {
          py += 56 * s;
          ctx.textAlign = 'right';
          ctx.font = `600 ${36 * s}px ${TEXT}`; ctx.fillStyle = C.brown; ctx.fillText(money(x.priceCents), W - M, py - 10 * s);
          ctx.font = `400 ${30 * s}px ${TEXT}`; ctx.fillStyle = C.soft; ctx.fillText(x.name, W - M - priceW - 22 * s, py - 10 * s);
        }
      }
      y += h + 44 * s;
      if (idx < shown.length - 1 || groups.length) {
        if (paint) { ctx.fillStyle = C.line; ctx.fillRect(M, y, inner, 2 * s); }
        y += 48 * s;
      }
    });

    // Trocas: título pequeno e a lista em texto corrido
    for (const g of groups) {
      ctx.font = `400 ${34 * s}px ${TEXT}`;
      const lines = wrap(ctx, g.items.join(', '), inner);
      if (paint) {
        ctx.textAlign = 'left'; ctx.font = `600 ${30 * s}px ${TEXT}`; ctx.fillStyle = C.brown; ctx.fillText(g.title, M, y + 30 * s);
        ctx.font = `400 ${34 * s}px ${TEXT}`; ctx.fillStyle = C.body;
        lines.forEach((l, k) => ctx.fillText(l, M, y + 30 * s + 52 * s * (k + 1)));
      }
      y += 30 * s + lines.length * 52 * s + 40 * s;
    }
    return y;
  };

  const top0 = photoH + (photo ? 56 : fmt === 'status' ? 84 : 56);
  const limit = H - footH - 20;
  let s = 1;
  while (s > 0.55 && plan(s, false, top0) > limit) s -= 0.03;

  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
  if (photo) {
    const pic = enhance(photo, W, photoH);
    ctx.drawImage(pic, 0, 0);
  } else {
    ctx.fillStyle = C.yellow; ctx.fillRect(0, 0, W, 14); // um fio amarelo no topo, só de acento
  }
  // cardápio curto: centraliza no espaço livre (sem colar no topo)
  const used = plan(s, false, top0);
  const free = Math.max(0, limit - used);
  plan(s, true, top0 + Math.min(free / 2, 140));

  // rodapé: WhatsApp, sem caixa colorida
  const fy = H - footH;
  ctx.fillStyle = C.line; ctx.fillRect(M, fy, inner, 2);
  ctx.textAlign = 'center';
  if (phone) {
    ctx.fillStyle = C.soft; ctx.font = `400 30px ${TEXT}`; ctx.fillText('Pedidos pelo WhatsApp', W / 2, fy + (fmt === 'status' ? 74 : 60));
    ctx.fillStyle = C.ink; ctx.font = `400 ${fmt === 'status' ? 78 : 66}px ${DISPLAY}`; ctx.fillText(phone, W / 2, fy + (fmt === 'status' ? 158 : 132));
  } else {
    ctx.fillStyle = C.ink; ctx.font = `400 60px ${DISPLAY}`; ctx.fillText(est.name, W / 2, fy + footH / 2 + 20);
  }
  if (est.hours && fmt === 'status') { ctx.fillStyle = C.soft; ctx.font = `400 26px ${TEXT}`; ctx.fillText(est.hours, W / 2, fy + 214); }

  const blob = await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Não foi possível gerar a imagem.'))), 'image/png'));
  return { blob, url: URL.createObjectURL(blob) };
}

function loadImg(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

export default function MenuImage({ options, swaps, date }: { options: DayMenuOption[]; swaps: SwapGroup[]; date: string }) {
  const { settings } = useApp();
  const [fmt, setFmt] = useState<Format>('status');
  const [photo, setPhoto] = useState<{ img: HTMLImageElement; url: string } | null>(null);
  const [out, setOut] = useState<Drawn | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const logo = useRef<HTMLImageElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const key = JSON.stringify([fmt, options, swaps, date, settings?.sizes, settings?.establishment, !!photo, photo?.url]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        if (!logo.current) logo.current = await loadImg('/logo-512.png').catch(() => null);
        const r = await draw(fmt, options, swaps, date, settings!.sizes, settings!.establishment, logo.current, photo?.img ?? null);
        if (!alive) { URL.revokeObjectURL(r.url); return; }
        setOut((old) => { if (old) URL.revokeObjectURL(old.url); return r; });
        setErr(null);
      } catch (e: any) { if (alive) setErr(e.message ?? 'Não foi possível gerar a imagem.'); }
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (f?: File) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    try { const img = await loadImg(url); setPhoto((old) => { if (old) URL.revokeObjectURL(old.url); return { img, url }; }); }
    catch { setErr('Não deu para abrir essa foto. Tente outra.'); URL.revokeObjectURL(url); }
    if (fileRef.current) fileRef.current.value = '';
  };
  const fileName = `cardapio-${date}-${fmt}.png`;
  const canShare = typeof navigator !== 'undefined' && !!navigator.canShare && !!out && navigator.canShare({ files: [new File([out.blob], fileName, { type: 'image/png' })] });
  const share = async () => {
    if (!out) return;
    try { await navigator.share({ files: [new File([out.blob], fileName, { type: 'image/png' })] }); } catch { /* cancelou */ }
  };
  const nothing = options.filter((o) => !o.soldOut && o.name.trim()).length === 0;

  return (
    <section className="card mt-4 p-4">
      <h2 className="mb-1 font-bold">Imagem do cardápio</h2>
      <p className="mb-3 text-sm text-slate-500">Pronta para o status do WhatsApp e o Instagram, no estilo da marca. Atualiza sozinha quando você muda o cardápio acima. Opções esgotadas não aparecem.</p>
      <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_1fr]">
        <div className="mx-auto w-full max-w-[320px]">
          {out && !nothing
            ? <img src={out.url} alt={`Imagem do cardápio de ${date}`} className="w-full rounded-xl border border-slate-200 shadow-sm" />
            : <div className="flex aspect-[9/16] items-center justify-center rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">{nothing ? 'Coloque pelo menos uma opção no cardápio.' : 'Montando a imagem…'}</div>}
        </div>
        <div className="space-y-4">
          <div>
            <div className="label">Formato</div>
            <div className="inline-flex rounded-lg border border-slate-300 p-0.5 text-sm font-semibold" role="group" aria-label="Formato da imagem">
              {([['status', 'Status / Stories (em pé)'], ['feed', 'Feed do Instagram']] as const).map(([k, t]) => (
                <button key={k} type="button" aria-pressed={fmt === k} onClick={() => setFmt(k)} className={`rounded-md px-3 py-1.5 ${fmt === k ? 'bg-brand-500 text-white' : 'text-slate-600'}`}>{t}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="label">Foto do prato (opcional)</div>
            <p className="mb-2 text-xs text-slate-500">Tire a foto de cima, perto da janela, sem flash. O sistema ajusta a luz e a cor sozinho.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => fileRef.current?.click()}><ImagePlus className="h-4 w-4" />{photo ? 'Trocar foto' : 'Colocar foto'}</Button>
              {photo && <Button variant="ghost" onClick={() => setPhoto((old) => { if (old) URL.revokeObjectURL(old.url); return null; })}><X className="h-4 w-4" />Tirar foto</Button>}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label="Escolher foto do prato" onChange={(e) => pick(e.target.files?.[0])} />
            </div>
          </div>
          {err && <p className="text-sm text-red-700">{err}</p>}
          <div className="flex flex-wrap gap-2">
            {canShare && <Button onClick={share} disabled={nothing}><Share2 className="h-4 w-4" />Compartilhar</Button>}
            {out && !nothing && <a href={out.url} download={fileName} className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold ${canShare ? 'border border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-brand-500 text-white hover:bg-brand-600'}`}><Download className="h-4 w-4" />Baixar imagem</a>}
          </div>
          <p className="text-xs text-slate-500">No celular, “Compartilhar” abre direto o WhatsApp ou o Instagram. A imagem não é guardada no sistema: gere de novo quando quiser.</p>
        </div>
      </div>
    </section>
  );
}
