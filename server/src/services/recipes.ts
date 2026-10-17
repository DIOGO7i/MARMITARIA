// Ficha técnica: ingredientes por tamanho de marmita, custo/lucro e baixa automática de estoque por pedido.
import { audit, getSettings } from '../db';
import { ValidationError } from '../money';
import { applyMovement } from '../stock';
import { Ctx, NotFoundError, now } from './common';

const ORDER_FLOW = ['pendente', 'em_preparo', 'pronto', 'saiu_para_entrega', 'entregue'];

function recipeFor(ctx: Ctx, size: string) {
  return ctx.db.prepare('SELECT * FROM recipes WHERE size = ?').get(size) as { id: number; size: string; active: number } | undefined;
}

export function listRecipes(ctx: Ctx) {
  const { db } = ctx;
  const st = getSettings(db);
  const sizes = st.sizes.map((s) => {
    const r = recipeFor(ctx, s.name);
    const items = r ? (db.prepare(`SELECT ri.product_id AS productId, p.name AS productName, p.unit, ri.qty_milli AS qtyMilli, p.unit_cost_cents AS unitCostCents, p.active
      FROM recipe_items ri JOIN products p ON p.id = ri.product_id WHERE ri.recipe_id = ? ORDER BY ri.id`).all(r.id) as any[]) : [];
    const lines = items.map((i) => ({ ...i, active: !!i.active, costCents: Math.round((i.qtyMilli * i.unitCostCents) / 1000), noCost: i.unitCostCents === 0 }));
    const costCents = lines.reduce((a, l) => a + l.costCents, 0);
    const marginCents = s.priceCents - costCents;
    const marginPct = s.priceCents > 0 ? Math.round((marginCents / s.priceCents) * 1000) / 10 : 0;
    return {
      size: s.name, priceCents: s.priceCents, items: lines, costCents, marginCents, marginPct,
      hasRecipe: lines.length > 0, missingCost: lines.some((l) => l.noCost),
      lowMargin: lines.length > 0 && marginPct < st.minMarginPct,
    };
  });
  return { sizes, stockDeductOn: st.stockDeductOn, minMarginPct: st.minMarginPct };
}

export function saveRecipe(ctx: Ctx, size: string, items: { productId: number; qtyMilli: number }[]) {
  const { db } = ctx;
  if (!getSettings(db).sizes.some((s) => s.name === size)) throw new NotFoundError('Tamanho de marmita não encontrado.');
  const ids = items.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) throw new ValidationError('O mesmo ingrediente aparece duas vezes.');
  for (const i of items) {
    if (!Number.isInteger(i.qtyMilli) || i.qtyMilli <= 0) throw new ValidationError('Quantidade de ingrediente inválida.');
    if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(i.productId)) throw new ValidationError('Ingrediente não encontrado no estoque.');
  }
  db.transaction(() => {
    let r = recipeFor(ctx, size);
    if (!r) { db.prepare('INSERT INTO recipes(size, active) VALUES (?, 1)').run(size); r = recipeFor(ctx, size)!; }
    db.prepare('DELETE FROM recipe_items WHERE recipe_id = ?').run(r.id);
    const ins = db.prepare('INSERT INTO recipe_items(recipe_id, product_id, qty_milli) VALUES (?,?,?)');
    for (const i of items) ins.run(r.id, i.productId, i.qtyMilli);
    db.prepare('UPDATE recipes SET active = ? WHERE id = ?').run(items.length ? 1 : 0, r.id);
    audit(db, 'ficha_tecnica', r.id, 'salva', { tamanho: size, itens: items.length }, ctx.userId);
  })();
  return listRecipes(ctx);
}

/** Ingredientes que um pedido consome (soma por produto), conforme as fichas atuais. */
function orderNeeds(ctx: Ctx, orderId: number) {
  const items = ctx.db.prepare('SELECT size, qty FROM order_items WHERE order_id = ?').all(orderId) as { size: string; qty: number }[];
  const need = new Map<number, number>();
  for (const it of items) {
    const r = recipeFor(ctx, it.size);
    if (!r || !r.active) continue;
    for (const ri of ctx.db.prepare('SELECT product_id, qty_milli FROM recipe_items WHERE recipe_id = ?').all(r.id) as { product_id: number; qty_milli: number }[]) {
      need.set(ri.product_id, (need.get(ri.product_id) ?? 0) + ri.qty_milli * it.qty);
    }
  }
  return need;
}

function reverseOrderStock(ctx: Ctx, orderId: number, number: number, why: string) {
  const { db } = ctx;
  const moves = db.prepare(`SELECT m.* FROM stock_movements m WHERE m.order_id = ? AND m.type = 'saida' AND m.reason = 'consumo'
    AND NOT EXISTS (SELECT 1 FROM stock_movements r WHERE r.reverses_id = m.id)`).all(orderId) as any[];
  const at = now(db).dateTime;
  for (const m of moves) {
    applyMovement(db, { productId: m.product_id, deltaMilli: -m.qty_milli, type: 'estorno', reason: 'estorno_pedido', occurredAt: at, unitCostCents: m.unit_cost_cents, orderId, reversesId: m.id, notes: `Pedido #${number}: ${why}`, userId: ctx.userId });
  }
  db.prepare('UPDATE orders SET stock_consumed = 0 WHERE id = ?').run(orderId);
}

function applyOrderStock(ctx: Ctx, orderId: number, number: number) {
  const { db } = ctx;
  const at = now(db).dateTime;
  let any = false;
  for (const [productId, qty] of orderNeeds(ctx, orderId)) {
    const p = db.prepare('SELECT unit_cost_cents FROM products WHERE id = ?').get(productId) as any;
    // A cozinha já usou os ingredientes: a baixa não pode travar o pedido. Se o saldo ficar negativo, o alerta de estoque mostra.
    applyMovement(db, { productId, deltaMilli: -qty, type: 'saida', reason: 'consumo', occurredAt: at, unitCostCents: p?.unit_cost_cents ?? 0, orderId, notes: `Pedido #${number} (ficha técnica)`, userId: ctx.userId, allowNegative: true });
    any = true;
  }
  db.prepare('UPDATE orders SET stock_consumed = ? WHERE id = ?').run(any ? 1 : 0, orderId);
}

/**
 * Mantém o estoque coerente com o pedido. Deve rodar DENTRO da transação do pedido.
 * - Chegou (ou passou) do status configurado e ainda não baixou → baixa.
 * - Voltou para antes, foi cancelado, ou foi editado depois da baixa → estorna (e baixa de novo se for o caso).
 */
export function syncOrderStock(ctx: Ctx, orderId: number, opts: { edited?: boolean } = {}) {
  const o = ctx.db.prepare('SELECT id, number, status, stock_consumed FROM orders WHERE id = ?').get(orderId) as any;
  if (!o) return;
  const trigger = ctx.modules && !ctx.modules.fichas ? 'desativado' : getSettings(ctx.db).stockDeductOn; // sem o módulo de fichas, nada é baixado automaticamente
  const should = trigger !== 'desativado' && o.status !== 'cancelado' && ORDER_FLOW.indexOf(o.status) >= ORDER_FLOW.indexOf(trigger);
  if (o.stock_consumed && (!should || opts.edited)) {
    reverseOrderStock(ctx, orderId, o.number, o.status === 'cancelado' ? 'pedido cancelado' : opts.edited ? 'pedido editado' : 'status voltou');
  }
  if (should) {
    const cur = ctx.db.prepare('SELECT stock_consumed FROM orders WHERE id = ?').get(orderId) as any;
    if (!cur.stock_consumed) applyOrderStock(ctx, orderId, o.number);
  }
}
