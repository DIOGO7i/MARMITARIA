// Apagar dados de teste (só a responsável): pedidos e/ou clientes, antes de começar a usar de verdade.
// Fica tudo o resto: cardápio, configurações, equipe, compras, despesas, estoque, caixa.
import { audit } from '../db';
import { ValidationError } from '../money';
import { Ctx, reqDate } from './common';

export function cleanupTestData(ctx: Ctx, opts: { orders: boolean; customers: boolean; upTo: string }) {
  const { db } = ctx;
  if (!opts.orders && !opts.customers) throw new ValidationError('Escolha o que apagar.');
  reqDate(opts.upTo, 'Data');
  return db.transaction(() => {
    let orders = 0, customers = 0;
    if (opts.orders) {
      const ids = (db.prepare('SELECT id FROM orders WHERE order_date <= ?').all(opts.upTo) as { id: number }[]).map((r) => r.id);
      const each = (sql: string) => { const st = db.prepare(sql); for (const id of ids) st.run(id); };
      // estoque que esses pedidos tiraram (ficha técnica) volta para o saldo
      for (const id of ids) {
        for (const m of db.prepare('SELECT product_id, qty_milli FROM stock_movements WHERE order_id = ?').all(id) as { product_id: number; qty_milli: number }[]) {
          db.prepare('UPDATE products SET qty_milli = qty_milli - ? WHERE id = ?').run(m.qty_milli, m.product_id);
        }
      }
      each('DELETE FROM stock_movements WHERE order_id = ?');
      each("DELETE FROM payments WHERE ref_type = 'pedido' AND ref_id = ?");
      each('DELETE FROM print_jobs WHERE order_id = ?');
      each('DELETE FROM order_items WHERE order_id = ?');
      each('DELETE FROM orders WHERE id = ?');
      orders = ids.length;
    }
    if (opts.customers) {
      db.prepare('UPDATE orders SET customer_id = NULL, customer_address_id = NULL WHERE customer_id IS NOT NULL').run();
      db.prepare('DELETE FROM customer_addresses').run();
      customers = Number(db.prepare('DELETE FROM customers').run().changes);
    }
    audit(db, 'sistema', null, 'dados_de_teste_apagados', { pedidos: orders, clientes: customers, ate: opts.upTo }, ctx.userId);
    return { orders, customers };
  })();
}
