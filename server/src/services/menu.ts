// Cardápio do dia: a dona monta de manhã (o que vai em cada opção, quais tamanhos) e marca "esgotou" durante o movimento.
import { audit, getSettings } from '../db';
import { ValidationError } from '../money';
import { Ctx, reqDate } from './common';

/** Uma parte da marmita: "Carne: Frango empanado", que pode virar Almôndegas ou Omelete. */
export interface MenuPart { label: string; value: string; swaps: string[] }
export interface MenuOption { name: string; description: string; sizes: string[]; soldOut: boolean; parts?: MenuPart[]; carnes?: number; guarnicoes?: number }
/** Carnes e guarnições do dia: viram botões no pedido. */
export interface DayItem { name: string; soldOut: boolean }
export interface DayItems { carnes: DayItem[]; guarnicoes: DayItem[] }
/** O que a atendente escolheu numa marmita. Guarnição pode repetir (2x Purê). */
export interface Choices { carnes: string[]; guarnicoes: string[] }
const KINDS = { carnes: 'carne', guarnicoes: 'guarnição' } as const;
const PLURAL = { carnes: 'carnes', guarnicoes: 'guarnições' } as const;
const parseItems = (raw: string | null | undefined): DayItems => {
  try { const v = raw ? JSON.parse(raw) : null; return { carnes: Array.isArray(v?.carnes) ? v.carnes : [], guarnicoes: Array.isArray(v?.guarnicoes) ? v.guarnicoes : [] }; }
  catch { return { carnes: [], guarnicoes: [] }; }
};
function cleanItems(x: unknown): DayItems {
  const out: DayItems = { carnes: [], guarnicoes: [] };
  for (const k of ['carnes', 'guarnicoes'] as const) {
    const list = (x as any)?.[k];
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list)) throw new ValidationError(`Lista de ${PLURAL[k]} inválida.`);
    const seen = new Set<string>();
    for (const it of list) {
      const name = String(typeof it === 'string' ? it : it?.name ?? '').trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      if (name.length > 60) throw new ValidationError(`“${name.slice(0, 20)}…” está muito longo (máx. 60 letras).`);
      seen.add(name.toLowerCase());
      out[k].push({ name, soldOut: typeof it === 'object' && !!it?.soldOut });
    }
    if (out[k].length > 30) throw new ValidationError(`No máximo 30 ${PLURAL[k]} no dia.`);
  }
  return out;
}
const limit = (v: unknown, def: number, max: number, what: string, option: string) => {
  const n = v === undefined || v === null || v === '' ? def : Number(v);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new ValidationError(`${option}: quantidade de ${what} inválida (0 a ${max}).`);
  return n;
};
/** Trocas do dia (ex.: "Opções para substituir a carne": Almôndegas, Coxa assada…). Saem no WhatsApp e na imagem do cardápio. */
export interface SwapGroup { title: string; items: string[] }
const DEFAULT_SWAPS: SwapGroup[] = [{ title: 'Para trocar a carne', items: [] }, { title: 'Para trocar a guarnição', items: [] }];
const parseSwaps = (raw: string | null | undefined): SwapGroup[] => { try { const v = raw ? JSON.parse(raw) : null; return Array.isArray(v) ? v : []; } catch { return []; } };

function cleanSwaps(list: unknown): SwapGroup[] {
  if (!Array.isArray(list)) return [];
  if (list.length > 4) throw new ValidationError('No máximo 4 grupos de trocas.');
  return list.map((g: any) => {
    const title = String(g?.title ?? '').trim().slice(0, 60);
    const items = (Array.isArray(g?.items) ? g.items : []).map((x: unknown) => String(x ?? '').trim()).filter(Boolean);
    if (items.length > 12) throw new ValidationError(`Muitas trocas em “${title}” (máx. 12).`);
    if (items.some((x: string) => x.length > 60)) throw new ValidationError(`Uma troca em “${title}” está muito longa (máx. 60 letras).`);
    if (items.length && !title) throw new ValidationError('Dê um título para o grupo de trocas.');
    return { title, items };
  }).filter((g) => g.title || g.items.length);
}

function template(ctx: Ctx): MenuOption[] {
  return getSettings(ctx.db).menuOptions.map((o) => ({ name: o.name, description: o.description ?? '', sizes: o.sizes ?? [], soldOut: false, carnes: o.carnes ?? 1, guarnicoes: o.guarnicoes ?? 1 }));
}

function row(ctx: Ctx, date: string) {
  return ctx.db.prepare(`SELECT m.menu_date, m.options, m.extras, m.items, m.updated_at, u.name AS user_name FROM daily_menus m LEFT JOIN users u ON u.id = m.updated_by WHERE m.menu_date = ?`).get(date) as any;
}

/** Opções valendo para o dia: as salvas, ou o modelo das Configurações se o cardápio ainda não foi montado. */
export function optionsFor(ctx: Ctx, date: string): { saved: boolean; options: MenuOption[] } {
  const r = row(ctx, date);
  return r ? { saved: true, options: JSON.parse(r.options) } : { saved: false, options: template(ctx) };
}

export function getMenu(ctx: Ctx, date: string) {
  reqDate(date, 'Data do cardápio');
  const r = row(ctx, date);
  const prev = ctx.db.prepare('SELECT menu_date, options, extras, items FROM daily_menus WHERE menu_date < ? ORDER BY menu_date DESC LIMIT 1').get(date) as any;
  const swaps = r ? parseSwaps(r.extras) : [];
  return {
    date,
    saved: !!r,
    options: r ? JSON.parse(r.options) as MenuOption[] : template(ctx),
    // dia ainda não montado: mostra os grupos vazios para preencher
    swaps: r ? swaps : DEFAULT_SWAPS.map((g) => ({ ...g, items: [] })),
    items: r ? parseItems(r.items) : { carnes: [], guarnicoes: [] },
    updatedAt: r?.updated_at ?? null,
    updatedBy: r?.user_name ?? null,
    previous: prev ? { date: prev.menu_date, options: JSON.parse(prev.options) as MenuOption[], swaps: parseSwaps(prev.extras), items: parseItems(prev.items) } : null,
  };
}

/** Partes da marmita (Acompanhamento, Carne, Guarnição…) e o que cada uma pode virar. Partes vazias são descartadas. */
function cleanParts(option: string, list: unknown): MenuPart[] {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new ValidationError(`Montagem inválida na ${option}.`);
  const out: MenuPart[] = [];
  for (const p of list as any[]) {
    const label = String(p?.label ?? '').trim();
    const value = String(p?.value ?? '').trim();
    const seen = new Set([value.toLowerCase()]);
    const swaps = (Array.isArray(p?.swaps) ? p.swaps : []).map((x: unknown) => String(x ?? '').trim())
      .filter((x: string) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
    if (!value && !swaps.length) continue;
    if (!value) throw new ValidationError(`${option}: diga o que vai em “${label || 'uma parte'}” antes das trocas.`);
    if (label.length > 30) throw new ValidationError(`${option}: nome da parte muito longo: “${label.slice(0, 20)}…”.`);
    if (value.length > 80) throw new ValidationError(`${option}: “${value.slice(0, 20)}…” está muito longo (máx. 80 letras).`);
    if (swaps.length > 12) throw new ValidationError(`${option}: muitas trocas em “${label || value}” (máx. 12).`);
    if (swaps.some((x: string) => x.length > 60)) throw new ValidationError(`${option}: uma troca em “${label || value}” está muito longa (máx. 60 letras).`);
    out.push({ label, value, swaps });
  }
  if (out.length > 8) throw new ValidationError(`${option}: no máximo 8 partes.`);
  return out;
}

function clean(ctx: Ctx, list: MenuOption[]): MenuOption[] {
  if (!Array.isArray(list) || list.length === 0) throw new ValidationError('O cardápio precisa de pelo menos uma opção.');
  if (list.length > 8) throw new ValidationError('No máximo 8 opções no cardápio.');
  const sizes = new Set(getSettings(ctx.db).sizes.map((s) => s.name));
  const tmpl = template(ctx);
  const seen = new Set<string>();
  return list.map((o) => {
    const name = String(o.name ?? '').trim();
    if (!name) throw new ValidationError('Toda opção do cardápio precisa de um nome.');
    if (name.length > 40) throw new ValidationError(`Nome da opção muito longo: “${name.slice(0, 20)}…”.`);
    if (seen.has(name.toLowerCase())) throw new ValidationError(`Há duas opções com o nome “${name}”.`);
    seen.add(name.toLowerCase());
    const parts = cleanParts(name, o.parts);
    // Montada por partes: a descrição (WhatsApp, comanda, pedido) sai das partes, para nunca ficar diferente.
    const description = parts.length ? parts.map((p) => p.value).join(', ') : String(o.description ?? '').trim();
    if (description.length > 300) throw new ValidationError(`A descrição da ${name} está muito longa (máx. 300 letras).`);
    const sz = [...new Set((o.sizes ?? []).map(String))];
    const bad = sz.find((s) => !sizes.has(s));
    if (bad) throw new ValidationError(`O tamanho “${bad}” não existe mais nas Configurações.`);
    const t = tmpl.find((x) => x.name === name);
    const carnes = limit(o.carnes, t?.carnes ?? 1, 3, 'carnes', name);
    const guarnicoes = limit(o.guarnicoes, t?.guarnicoes ?? 1, 4, 'guarnições', name);
    return { name, description, sizes: sz, soldOut: !!o.soldOut, carnes, guarnicoes, ...(parts.length ? { parts } : {}) };
  });
}

/** swaps undefined = mantém as trocas que já estavam (ex.: botão "Esgotou"). */
export function saveMenu(ctx: Ctx, date: string, options: MenuOption[], swaps?: SwapGroup[], items?: unknown) {
  reqDate(date, 'Data do cardápio');
  const list = clean(ctx, options);
  const sw = swaps === undefined ? parseSwaps(row(ctx, date)?.extras) : cleanSwaps(swaps);
  const it = items === undefined ? parseItems(row(ctx, date)?.items) : cleanItems(items);
  ctx.db.transaction(() => {
    ctx.db.prepare(`INSERT INTO daily_menus(menu_date, options, extras, items, updated_by) VALUES (?,?,?,?,?)
      ON CONFLICT(menu_date) DO UPDATE SET options = excluded.options, extras = excluded.extras, items = excluded.items, updated_by = excluded.updated_by, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
      .run(date, JSON.stringify(list), JSON.stringify(sw), JSON.stringify(it), ctx.userId);
    audit(ctx.db, 'cardapio', null, 'salvo', { data: date, opcoes: list.map((o) => o.name) }, ctx.userId);
  })();
  return getMenu(ctx, date);
}

/** Marca/desmarca "esgotou" numa opção (botão rápido da tela inicial). Se o cardápio ainda não foi salvo, salva o modelo. */
export function setSoldOut(ctx: Ctx, date: string, name: string, soldOut: boolean) {
  reqDate(date, 'Data do cardápio');
  const cur = optionsFor(ctx, date).options;
  const o = cur.find((x) => x.name === name);
  if (!o) throw new ValidationError(`A opção “${name}” não está no cardápio deste dia.`);
  o.soldOut = soldOut;
  return saveMenu(ctx, date, cur);
}

const countList = (l: string[]) => {
  const m = new Map<string, number>();
  for (const x of l) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].map(([n, q]) => (q > 1 ? `${q}x ${n}` : n));
};
/** "Arroz e feijão, Bisteca, 2x Purê" */
export function choicesText(base: string, c: Choices) {
  return [base.trim(), ...countList(c.carnes), ...countList(c.guarnicoes)].filter(Boolean).join(', ');
}

export interface ResolvedItem { description: string | null; choices: Choices | null }
/**
 * Para cada item do pedido: confere a opção e as carnes/guarnições escolhidas contra o cardápio do dia
 * e devolve a descrição e as escolhas que ficam gravadas no pedido.
 * Em pedido novo, opção ou item esgotado/fora do cardápio é recusado; acima do limite da opção também.
 * Na edição, o que o pedido já tinha continua valendo (mesmo se esgotou depois).
 */
export function resolveItemOptions(ctx: Ctx, date: string, items: { option?: string | null; choices?: Partial<Choices> | null }[],
  keep?: { options: Map<string, string | null>; names: Set<string> }): ResolvedItem[] {
  const { options } = optionsFor(ctx, date);
  const day = parseItems(row(ctx, date)?.items);
  const base = getSettings(ctx.db).marmitaBase ?? '';
  const when = date.split('-').reverse().join('/');
  return items.map((it) => {
    const name = it.option?.trim();
    if (!name) return { description: null, choices: null };
    const o = options.find((x) => x.name === name);
    const kept = !!keep?.options.has(name);
    if (!o) {
      if (kept) return { description: keep!.options.get(name) ?? null, choices: it.choices ? { carnes: [...(it.choices.carnes ?? [])], guarnicoes: [...(it.choices.guarnicoes ?? [])] } : null };
      throw new ValidationError(`A ${name} não está no cardápio de ${when}. Atualize a tela e escolha de novo.`);
    }
    if (o.soldOut && !kept) throw new ValidationError(`A ${name} esgotou. Escolha outra opção.`);
    if (!it.choices) return { description: kept ? keep!.options.get(name) ?? null : o.description || null, choices: null };
    const c: Choices = { carnes: (it.choices.carnes ?? []).map((x) => String(x).trim()).filter(Boolean), guarnicoes: (it.choices.guarnicoes ?? []).map((x) => String(x).trim()).filter(Boolean) };
    for (const k of ['carnes', 'guarnicoes'] as const) {
      const max = o[k] ?? 1;
      if (c[k].length > max) throw new ValidationError(`A ${name} leva ${max === 0 ? 'nenhuma' : `só ${max}`} ${max > 1 ? PLURAL[k] : KINDS[k]}.`);
      for (const n of c[k]) {
        const d = day[k].find((x) => x.name.toLowerCase() === n.toLowerCase());
        const old = keep?.names.has(n.toLowerCase());
        if (!d && !old) throw new ValidationError(`“${n}” não está nas ${PLURAL[k]} de ${when}. Atualize a tela e escolha de novo.`);
        if (d?.soldOut && !old) throw new ValidationError(`“${n}” esgotou. Escolha outra ${KINDS[k]}.`);
      }
    }
    return { description: choicesText(base, c), choices: c };
  });
}
