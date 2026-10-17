// Cardápio do dia: a dona monta de manhã (o que vai em cada opção, quais tamanhos) e marca "esgotou" durante o movimento.
import { audit, getSettings } from '../db';
import { ValidationError } from '../money';
import { Ctx, reqDate } from './common';

export interface MenuOption { name: string; description: string; sizes: string[]; soldOut: boolean }
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
  return getSettings(ctx.db).menuOptions.map((o) => ({ name: o.name, description: o.description ?? '', sizes: o.sizes ?? [], soldOut: false }));
}

function row(ctx: Ctx, date: string) {
  return ctx.db.prepare(`SELECT m.menu_date, m.options, m.extras, m.updated_at, u.name AS user_name FROM daily_menus m LEFT JOIN users u ON u.id = m.updated_by WHERE m.menu_date = ?`).get(date) as any;
}

/** Opções valendo para o dia: as salvas, ou o modelo das Configurações se o cardápio ainda não foi montado. */
export function optionsFor(ctx: Ctx, date: string): { saved: boolean; options: MenuOption[] } {
  const r = row(ctx, date);
  return r ? { saved: true, options: JSON.parse(r.options) } : { saved: false, options: template(ctx) };
}

export function getMenu(ctx: Ctx, date: string) {
  reqDate(date, 'Data do cardápio');
  const r = row(ctx, date);
  const prev = ctx.db.prepare('SELECT menu_date, options, extras FROM daily_menus WHERE menu_date < ? ORDER BY menu_date DESC LIMIT 1').get(date) as any;
  const swaps = r ? parseSwaps(r.extras) : [];
  return {
    date,
    saved: !!r,
    options: r ? JSON.parse(r.options) as MenuOption[] : template(ctx),
    // dia ainda não montado: mostra os grupos vazios para preencher
    swaps: r ? swaps : DEFAULT_SWAPS.map((g) => ({ ...g, items: [] })),
    updatedAt: r?.updated_at ?? null,
    updatedBy: r?.user_name ?? null,
    previous: prev ? { date: prev.menu_date, options: JSON.parse(prev.options) as MenuOption[], swaps: parseSwaps(prev.extras) } : null,
  };
}

function clean(ctx: Ctx, list: MenuOption[]): MenuOption[] {
  if (!Array.isArray(list) || list.length === 0) throw new ValidationError('O cardápio precisa de pelo menos uma opção.');
  if (list.length > 8) throw new ValidationError('No máximo 8 opções no cardápio.');
  const sizes = new Set(getSettings(ctx.db).sizes.map((s) => s.name));
  const seen = new Set<string>();
  return list.map((o) => {
    const name = String(o.name ?? '').trim();
    if (!name) throw new ValidationError('Toda opção do cardápio precisa de um nome.');
    if (name.length > 40) throw new ValidationError(`Nome da opção muito longo: “${name.slice(0, 20)}…”.`);
    if (seen.has(name.toLowerCase())) throw new ValidationError(`Há duas opções com o nome “${name}”.`);
    seen.add(name.toLowerCase());
    const description = String(o.description ?? '').trim();
    if (description.length > 300) throw new ValidationError(`A descrição da ${name} está muito longa (máx. 300 letras).`);
    const sz = [...new Set((o.sizes ?? []).map(String))];
    const bad = sz.find((s) => !sizes.has(s));
    if (bad) throw new ValidationError(`O tamanho “${bad}” não existe mais nas Configurações.`);
    return { name, description, sizes: sz, soldOut: !!o.soldOut };
  });
}

/** swaps undefined = mantém as trocas que já estavam (ex.: botão "Esgotou"). */
export function saveMenu(ctx: Ctx, date: string, options: MenuOption[], swaps?: SwapGroup[]) {
  reqDate(date, 'Data do cardápio');
  const list = clean(ctx, options);
  const sw = swaps === undefined ? parseSwaps(row(ctx, date)?.extras) : cleanSwaps(swaps);
  ctx.db.transaction(() => {
    ctx.db.prepare(`INSERT INTO daily_menus(menu_date, options, extras, updated_by) VALUES (?,?,?,?)
      ON CONFLICT(menu_date) DO UPDATE SET options = excluded.options, extras = excluded.extras, updated_by = excluded.updated_by, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
      .run(date, JSON.stringify(list), JSON.stringify(sw), ctx.userId);
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

/**
 * Para cada item do pedido: confere a opção contra o cardápio do dia e devolve a descrição que fica gravada no pedido.
 * Em pedido novo, opção esgotada ou fora do cardápio é recusada. Na edição, opções que o pedido já tinha continuam valendo.
 */
export function resolveItemOptions(ctx: Ctx, date: string, items: { option?: string | null }[], keep?: Map<string, string | null>) {
  const { options } = optionsFor(ctx, date);
  return items.map((it) => {
    const name = it.option?.trim();
    if (!name) return null;
    if (keep?.has(name)) return keep.get(name) ?? null;
    const o = options.find((x) => x.name === name);
    if (!o) throw new ValidationError(`A ${name} não está no cardápio de ${date.split('-').reverse().join('/')}. Atualize a tela e escolha de novo.`);
    if (o.soldOut) throw new ValidationError(`A ${name} esgotou. Escolha outra opção.`);
    return o.description || null;
  });
}
