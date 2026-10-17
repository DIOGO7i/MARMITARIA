// Impressão automática na cozinha. O pedido entra na fila; a tela "Cozinha" imprime.
import { getSettings } from '../db';
import { Ctx, NotFoundError } from './common';
import { getOrder } from './orders';

export type PrintKind = 'novo' | 'alterado' | 'cancelado' | 'reaberto' | 'reimpressao';
const HOURS_BACK = 12; // ao abrir a tela de manhã, não imprime pedidos de ontem esquecidos na fila

export function enqueuePrint(db: Ctx['db'], orderId: number, kind: PrintKind) {
  const cfg = getSettings(db).kitchenPrint;
  if (!cfg.enabled && kind !== 'reimpressao') return;
  if (kind === 'alterado' && !cfg.printEdits) return;
  if (kind === 'cancelado' && !cfg.printCancels) return;
  // se ainda há uma comanda do mesmo pedido esperando, não precisa de duas: a que for impressa já sai atualizada
  const waiting = db.prepare('SELECT id, kind FROM print_jobs WHERE order_id = ? AND claimed_at IS NULL').get(orderId) as any;
  if (waiting && kind !== 'cancelado') return;
  if (waiting && kind === 'cancelado') {
    // nem chegou a imprimir: some da fila, e a cozinha não precisa de aviso de cancelamento
    if (waiting.kind === 'novo') { db.prepare('DELETE FROM print_jobs WHERE id = ?').run(waiting.id); return; }
    db.prepare('DELETE FROM print_jobs WHERE id = ?').run(waiting.id);
  }
  db.prepare('INSERT INTO print_jobs(order_id, kind) VALUES (?, ?)').run(orderId, kind);
}

const since = () => new Date(Date.now() - HOURS_BACK * 3_600_000).toISOString();

/** Comandas esperando impressão (as mais antigas primeiro), já com o pedido completo. */
export function pendingPrints(ctx: Ctx) {
  const rows = ctx.db.prepare('SELECT * FROM print_jobs WHERE claimed_at IS NULL AND created_at >= ? ORDER BY id LIMIT 20').all(since()) as any[];
  return rows.map((r) => ({ id: r.id, kind: r.kind as PrintKind, createdAt: r.created_at, order: getOrder(ctx, r.order_id) }));
}

/** A tela da cozinha "pega" a comanda antes de imprimir. Só a primeira consegue (duas telas abertas não imprimem duas vezes). */
export function claimPrint(ctx: Ctx, id: number) {
  const r = ctx.db.prepare('UPDATE print_jobs SET claimed_at = ?, claimed_by = ? WHERE id = ? AND claimed_at IS NULL').run(new Date().toISOString(), ctx.userId, id);
  return { ok: r.changes === 1 };
}

/** Pedir de novo a impressão de um pedido (papel acabou, comanda molhou...). */
export function reprint(ctx: Ctx, orderId: number) {
  if (!ctx.db.prepare('SELECT 1 FROM orders WHERE id = ?').get(orderId)) throw new NotFoundError('Pedido não encontrado.');
  ctx.db.prepare("INSERT INTO print_jobs(order_id, kind) VALUES (?, 'reimpressao')").run(orderId);
  return { ok: true };
}

/** Últimas comandas (para a tela da cozinha mostrar o que já saiu). */
export function recentPrints(ctx: Ctx) {
  return ctx.db.prepare(`SELECT j.id, j.kind, j.created_at AS createdAt, j.claimed_at AS printedAt, o.id AS orderId, o.number, o.customer_name AS customerName, o.delivery_type AS deliveryType, o.status
    FROM print_jobs j JOIN orders o ON o.id = j.order_id WHERE j.created_at >= ? ORDER BY j.id DESC LIMIT 40`).all(since());
}
