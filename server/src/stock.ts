import type { DB } from './db';
import { ValidationError } from './money';

export type MovementReason =
  | 'compra' | 'consumo' | 'perda' | 'descarte' | 'uso_interno'
  | 'ajuste_inventario' | 'outro' | 'cancelamento_compra' | 'saldo_inicial' | 'estorno_pedido';

export interface MoveInput {
  productId: number;
  deltaMilli: number; // + entrada, - saída
  type: 'entrada' | 'saida' | 'estorno';
  reason: MovementReason;
  occurredAt: string; // 'YYYY-MM-DDTHH:MM' local
  unitCostCents?: number | null;
  purchaseId?: number | null;
  orderId?: number | null;
  reversesId?: number | null;
  notes?: string | null;
  userId?: number | null;
  allowNegative?: boolean;
}

/**
 * Único ponto que altera o saldo de um produto. DEVE ser chamado dentro de uma transação
 * (db.transaction) pelo chamador, para ser atômico junto com compra/pagamento.
 */
export function applyMovement(db: DB, m: MoveInput) {
  if (!Number.isInteger(m.deltaMilli) || m.deltaMilli === 0) throw new ValidationError('Quantidade da movimentação inválida.');
  const p = db.prepare('SELECT id, name, qty_milli FROM products WHERE id = ?').get(m.productId) as
    | { id: number; name: string; qty_milli: number } | undefined;
  if (!p) throw new ValidationError('Produto não encontrado.');
  const before = p.qty_milli;
  const after = before + m.deltaMilli;
  if (after < 0 && !m.allowNegative) {
    throw new ValidationError(`Estoque insuficiente de "${p.name}": saldo atual ${before / 1000}, saída pedida ${-m.deltaMilli / 1000}.`);
  }
  const res = db.prepare(`INSERT INTO stock_movements
    (product_id, type, reason, qty_milli, balance_before_milli, balance_after_milli, unit_cost_cents,
     occurred_at, occurred_date, purchase_id, order_id, reverses_id, notes, user_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    m.productId, m.type, m.reason, m.deltaMilli, before, after, m.unitCostCents ?? null,
    m.occurredAt, m.occurredAt.slice(0, 10), m.purchaseId ?? null, m.orderId ?? null,
    m.reversesId ?? null, m.notes ?? null, m.userId ?? null,
  );
  db.prepare('UPDATE products SET qty_milli = ? WHERE id = ?').run(after, m.productId);
  return { id: Number(res.lastInsertRowid), before, after };
}

/** Confere se o saldo de cada produto bate com a soma do histórico. Retorna divergências. */
export function verifyBalances(db: DB) {
  return db.prepare(`
    SELECT p.id, p.name, p.qty_milli AS saldo, COALESCE(SUM(m.qty_milli),0) AS historico
    FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
    GROUP BY p.id HAVING p.qty_milli != COALESCE(SUM(m.qty_milli),0)`).all();
}
