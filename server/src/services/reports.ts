import { Ctx, now, reqDate } from './common';

const COST_REASONS = ['consumo', 'perda', 'descarte', 'uso_interno'];
const isCourier = (c: string) => /entregador/i.test(c);

export function summary(ctx: Ctx, from: string, to: string) {
  const { db } = ctx;
  reqDate(from, 'Data inicial'); reqDate(to, 'Data final');
  const o = db.prepare(`SELECT
      COUNT(*) AS registered,
      SUM(status='entregue') AS delivered,
      SUM(status='cancelado') AS cancelled,
      SUM(status='pendente') AS pending,
      SUM(status='em_preparo') AS preparing,
      SUM(status='pronto') AS ready,
      SUM(status='saiu_para_entrega') AS onTheWay,
      COALESCE(SUM(CASE WHEN status!='cancelado' THEN total_cents END),0) AS sales,
      COALESCE(SUM(CASE WHEN status!='cancelado' THEN delivery_fee_cents END),0) AS feeCharged,
      COALESCE(SUM(CASE WHEN status!='cancelado' THEN delivery_cost_cents END),0) AS deliveryCost,
      COALESCE(SUM(CASE WHEN status!='cancelado' THEN total_cents - paid_cents END),0) AS receivable,
      COALESCE(SUM(CASE WHEN status!='cancelado' THEN discount_cents END),0) AS discounts
    FROM orders WHERE order_date BETWEEN ? AND ?`).get(from, to) as any;

  const received = (db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE kind='recebimento' AND paid_date BETWEEN ? AND ?`).get(from, to) as any).s;
  const paymentsMade = (db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE kind='pagamento' AND paid_date BETWEEN ? AND ?`).get(from, to) as any).s;

  const pu = db.prepare(`SELECT COALESCE(SUM(total_cents),0) AS total, COALESCE(SUM(total_cents - paid_cents),0) AS open, COUNT(*) AS n
    FROM purchases WHERE status='confirmada' AND purchase_date BETWEEN ? AND ?`).get(from, to) as any;

  const ex = db.prepare(`SELECT category, COALESCE(SUM(amount_cents),0) AS total, COALESCE(SUM(amount_cents - paid_cents),0) AS open
    FROM expenses WHERE voided=0 AND expense_date BETWEEN ? AND ? GROUP BY category`).all(from, to) as any[];
  const expensesTotal = ex.reduce((a, r) => a + r.total, 0);
  const expensesOpen = ex.reduce((a, r) => a + r.open, 0);
  const courierExpenses = ex.filter((r) => isCourier(r.category)).reduce((a, r) => a + r.total, 0);

  // Custo líquido dos insumos: baixas (consumo, perda...) menos os estornos de pedidos cancelados/editados.
  // O estorno conta na data da baixa que ele desfaz, para o custo do dia original ficar certo.
  const cons = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN m.type='saida' THEN 1 ELSE 0 END),0) AS n,
      COALESCE(SUM(-m.qty_milli * COALESCE(m.unit_cost_cents,0) / 1000.0),0) AS cost
    FROM stock_movements m LEFT JOIN stock_movements orig ON orig.id = m.reverses_id
    WHERE ((m.type='saida' AND m.reason IN (${COST_REASONS.map(() => '?').join(',')})) OR m.reason = 'estorno_pedido')
      AND COALESCE(orig.occurred_date, m.occurred_date) BETWEEN ? AND ?`).get(...COST_REASONS, from, to) as any;
  const consumptionCost = Math.round(cons.cost);

  // Resultado operacional ESTIMADO (competência): vendas − custo das entregas dos pedidos − despesas (sem duplicar entregadores)
  // − custo dos insumos efetivamente baixados do estoque. Compras NÃO são subtraídas diretamente (viram custo ao serem consumidas).
  const otherExpenses = expensesTotal - courierExpenses;
  const estimate = o.sales - o.deliveryCost - otherExpenses - consumptionCost;
  const missing: string[] = [];
  if (cons.n === 0) missing.push('Nenhuma baixa de insumos (consumo/perda/descarte) registrada no período: o custo das mercadorias vendidas está faltando.');
  if (courierExpenses > 0) missing.push('Pagamentos a entregadores lançados como despesa não foram somados ao custo de entrega dos pedidos, para não duplicar.');

  // Marmitas por opção do cardápio e tamanho (pedidos não cancelados)
  const byOption = db.prepare(`SELECT COALESCE(i.menu_option, 'Sem opção') AS option, i.size, SUM(i.qty) AS qty
    FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.status != 'cancelado' AND o.order_date BETWEEN ? AND ?
    GROUP BY COALESCE(i.menu_option, 'Sem opção'), i.size ORDER BY option, i.size`).all(from, to) as { option: string; size: string; qty: number }[];
  const optionTotals = new Map<string, { option: string; qty: number; sizes: { size: string; qty: number }[] }>();
  for (const r of byOption) {
    const t = optionTotals.get(r.option) ?? { option: r.option, qty: 0, sizes: [] };
    t.qty += r.qty; t.sizes.push({ size: r.size, qty: r.qty }); optionTotals.set(r.option, t);
  }

  // ---- Fatias para os gráficos de pizza ----
  // Para onde vai o dinheiro: compras de mercadoria + despesas por categoria + entregadores.
  // Entregadores: vale o custo informado nos pedidos; se não houver, o que foi lançado como despesa de entregador (nunca os dois, para não duplicar).
  const courier = o.deliveryCost > 0 ? o.deliveryCost : courierExpenses;
  const spending = [
    ...(pu.total > 0 ? [{ label: 'Compras de mercadoria', cents: pu.total }] : []),
    ...ex.filter((r) => !isCourier(r.category) && r.total > 0).map((r) => ({ label: r.category, cents: r.total })),
    ...(courier > 0 ? [{ label: 'Entregadores', cents: courier }] : []),
  ].sort((a, b) => b.cents - a.cents);
  // Como os clientes pagaram: recebimentos na data (estornos descontados), por forma
  const receivedByMethod = (db.prepare(`SELECT COALESCE(NULLIF(TRIM(method), ''), 'Não informada') AS label, SUM(amount_cents) AS cents
    FROM payments WHERE kind='recebimento' AND paid_date BETWEEN ? AND ? GROUP BY 1 HAVING SUM(amount_cents) > 0 ORDER BY 2 DESC`).all(from, to) as { label: string; cents: number }[]);
  // Marmitas por tamanho (somando as opções)
  const sizeMap = new Map<string, number>();
  for (const r of byOption) sizeMap.set(r.size, (sizeMap.get(r.size) ?? 0) + r.qty);
  const deliveryTypes = (db.prepare(`SELECT delivery_type AS type, COUNT(*) AS n, COALESCE(SUM(total_cents),0) AS cents FROM orders
    WHERE status != 'cancelado' AND order_date BETWEEN ? AND ? GROUP BY delivery_type`).all(from, to) as { type: string; n: number; cents: number }[]);

  return {
    from, to,
    charts: {
      spending,
      receivedByMethod,
      marmitasBySize: [...sizeMap.entries()].map(([label, qty]) => ({ label, qty })).sort((a, b) => b.qty - a.qty),
      marmitasByOption: [...optionTotals.values()].map((t) => ({ label: t.option, qty: t.qty })).sort((a, b) => b.qty - a.qty),
      deliveryTypes: ['retirada', 'entrega'].map((t) => { const r = deliveryTypes.find((x) => x.type === t); return { label: t === 'retirada' ? 'Retirada no local' : 'Entrega', qty: r?.n ?? 0, cents: r?.cents ?? 0 }; }).filter((x) => x.qty > 0),
    },
    marmitasByOption: [...optionTotals.values()],
    marmitasTotal: byOption.reduce((a, r) => a + r.qty, 0),
    orders: { registered: o.registered ?? 0, delivered: o.delivered ?? 0, cancelled: o.cancelled ?? 0, pending: o.pending ?? 0, preparing: o.preparing ?? 0, ready: o.ready ?? 0, onTheWay: o.onTheWay ?? 0 },
    salesCents: o.sales, discountsCents: o.discounts,
    receivedCents: received, receivableCents: o.receivable,
    deliveryFeeChargedCents: o.feeCharged, deliveryCostCents: o.deliveryCost,
    purchasesCents: pu.total, purchasesCount: pu.n,
    expensesCents: expensesTotal, courierExpensesCents: courierExpenses,
    paymentsMadeCents: paymentsMade, payablesPendingCents: pu.open + expensesOpen,
    consumptionCostCents: consumptionCost, consumptionMovements: cons.n,
    operatingEstimateCents: estimate, estimateMissing: missing,
    expensesByCategory: ex.map((r) => ({ category: r.category, totalCents: r.total })).sort((a, b) => b.totalCents - a.totalCents),
  };
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end && out.length < 400) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

export function dailySeries(ctx: Ctx, from: string, to: string) {
  const { db } = ctx;
  const m = (sql: string) => new Map((db.prepare(sql).all(from, to) as any[]).map((r) => [r.d, r.v as number]));
  const sales = m(`SELECT order_date d, SUM(total_cents) v FROM orders WHERE status!='cancelado' AND order_date BETWEEN ? AND ? GROUP BY d`);
  const received = m(`SELECT paid_date d, SUM(amount_cents) v FROM payments WHERE kind='recebimento' AND paid_date BETWEEN ? AND ? GROUP BY d`);
  const purchases = m(`SELECT purchase_date d, SUM(total_cents) v FROM purchases WHERE status='confirmada' AND purchase_date BETWEEN ? AND ? GROUP BY d`);
  const expenses = m(`SELECT expense_date d, SUM(amount_cents) v FROM expenses WHERE voided=0 AND expense_date BETWEEN ? AND ? GROUP BY d`);
  return eachDay(from, to).map((date) => ({
    date, salesCents: sales.get(date) ?? 0, receivedCents: received.get(date) ?? 0,
    purchasesCents: purchases.get(date) ?? 0, expensesCents: expenses.get(date) ?? 0,
  }));
}

export function stockAlerts(ctx: Ctx) {
  const r = ctx.db.prepare(`SELECT
    COALESCE(SUM(qty_milli > 0 AND qty_milli <= min_qty_milli),0) AS low,
    COALESCE(SUM(qty_milli <= 0),0) AS out FROM products WHERE active = 1`).get() as any;
  return { low: r.low, out: r.out };
}

export function recentActivity(ctx: Ctx, limit = 12) {
  const { db } = ctx;
  const items: { kind: string; label: string; valueCents: number | null; at: string }[] = [];
  for (const r of db.prepare(`SELECT number, customer_name, total_cents, status, created_at FROM orders ORDER BY id DESC LIMIT ?`).all(limit) as any[])
    items.push({ kind: 'pedido', label: `Pedido #${r.number}${r.customer_name ? ' — ' + r.customer_name : ''}${r.status === 'cancelado' ? ' (cancelado)' : ''}`, valueCents: r.total_cents, at: r.created_at });
  for (const r of db.prepare(`SELECT number, total_cents, status, created_at FROM purchases ORDER BY id DESC LIMIT ?`).all(limit) as any[])
    items.push({ kind: 'compra', label: `Compra #${r.number}${r.status === 'cancelada' ? ' (cancelada)' : ''}`, valueCents: r.total_cents, at: r.created_at });
  for (const r of db.prepare(`SELECT description, amount_cents, voided, created_at FROM expenses ORDER BY id DESC LIMIT ?`).all(limit) as any[])
    items.push({ kind: 'despesa', label: `Despesa: ${r.description}${r.voided ? ' (anulada)' : ''}`, valueCents: r.amount_cents, at: r.created_at });
  for (const r of db.prepare(`SELECT m.type, m.reason, m.qty_milli, p.name, p.unit, m.created_at FROM stock_movements m JOIN products p ON p.id = m.product_id WHERE m.reason != 'compra' ORDER BY m.id DESC LIMIT ?`).all(limit) as any[])
    items.push({ kind: 'estoque', label: `Estoque: ${r.name} ${r.qty_milli > 0 ? '+' : ''}${r.qty_milli / 1000} ${r.unit} (${r.reason.replace(/_/g, ' ')})`, valueCents: null, at: r.created_at });
  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}

export function dashboard(ctx: Ctx, from: string, to: string) {
  return { summary: summary(ctx, from, to), series: dailySeries(ctx, from, to), stock: stockAlerts(ctx), recent: recentActivity(ctx), today: now(ctx.db).date };
}

function prevMonth(year: number, month: number) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}
function range(year: number, month: number) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

export function monthly(ctx: Ctx, year: number, month: number) {
  const cur = range(year, month);
  const pm = prevMonth(year, month);
  const prev = range(pm.year, pm.month);
  const previous = summary(ctx, prev.from, prev.to);
  const hasPrevious = previous.orders.registered + previous.purchasesCount + previous.expensesCents > 0;
  return { current: summary(ctx, cur.from, cur.to), previous: hasPrevious ? previous : null, series: dailySeries(ctx, cur.from, cur.to) };
}

export function stockReport(ctx: Ctx, from: string, to: string) {
  const { db } = ctx;
  const products = db.prepare('SELECT * FROM products ORDER BY name').all() as any[];
  const rows = products.map((p) => ({
    id: p.id, name: p.name, unit: p.unit, active: !!p.active, qtyMilli: p.qty_milli, minQtyMilli: p.min_qty_milli, unitCostCents: p.unit_cost_cents,
    valueCents: Math.round((p.qty_milli * p.unit_cost_cents) / 1000),
    status: p.qty_milli <= 0 ? 'sem_estoque' : p.qty_milli <= p.min_qty_milli ? 'baixo' : 'ok',
  }));
  const mv = db.prepare(`SELECT product_id,
      COALESCE(SUM(CASE WHEN qty_milli > 0 THEN qty_milli END),0) AS inMilli,
      COALESCE(SUM(CASE WHEN qty_milli < 0 THEN -qty_milli END),0) AS outMilli, COUNT(*) AS n
    FROM stock_movements WHERE occurred_date BETWEEN ? AND ? GROUP BY product_id`).all(from, to) as any[];
  const byId = new Map(mv.map((m) => [m.product_id, m]));
  const detailed = rows.map((r) => ({ ...r, inMilli: byId.get(r.id)?.inMilli ?? 0, outMilli: byId.get(r.id)?.outMilli ?? 0, movements: byId.get(r.id)?.n ?? 0 }));
  return {
    from, to, rows: detailed,
    totalValueCents: rows.reduce((a, r) => a + r.valueCents, 0),
    belowMin: rows.filter((r) => r.active && r.status !== 'ok').length,
    mostMoved: [...detailed].filter((r) => r.movements > 0).sort((a, b) => b.movements - a.movements).slice(0, 10).map((r) => ({ id: r.id, name: r.name, movements: r.movements })),
    costMethod: 'Custo médio ponderado: cada compra recalcula o custo unitário do produto, incluindo o rateio de frete e desconto da compra.',
  };
}

/** Contas a pagar (compras e despesas em aberto) separadas por vencimento. */
export function payables(ctx: Ctx, days: number) {
  const { db } = ctx;
  const today = now(db).date;
  const limit = new Date(today + 'T00:00:00Z'); limit.setUTCDate(limit.getUTCDate() + days);
  const lim = limit.toISOString().slice(0, 10);
  const rows = [
    ...(db.prepare(`SELECT 'compra' AS type, p.id, 'Compra #' || p.number || COALESCE(' — ' || s.name, '') AS description, p.due_date AS dueDate, p.total_cents - p.paid_cents AS openCents
      FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.status = 'confirmada' AND p.total_cents > p.paid_cents`).all() as any[]),
    ...(db.prepare(`SELECT 'despesa' AS type, id, description, due_date AS dueDate, amount_cents - paid_cents AS openCents
      FROM expenses WHERE voided = 0 AND status != 'pago'`).all() as any[]),
  ];
  const tag = (r: any) => (!r.dueDate ? 'sem_vencimento' : r.dueDate < today ? 'vencida' : r.dueDate === today ? 'hoje' : r.dueDate <= lim ? 'em_breve' : 'depois');
  const items = rows.map((r) => ({ ...r, situation: tag(r) })).sort((a, b) => (a.dueDate ?? '9999') < (b.dueDate ?? '9999') ? -1 : 1);
  const sum = (s: string) => items.filter((i) => i.situation === s).reduce((a, i) => a + i.openCents, 0);
  const count = (s: string) => items.filter((i) => i.situation === s).length;
  return {
    today, days,
    overdue: { count: count('vencida'), totalCents: sum('vencida') },
    dueToday: { count: count('hoje'), totalCents: sum('hoje') },
    dueSoon: { count: count('em_breve'), totalCents: sum('em_breve') },
    noDue: { count: count('sem_vencimento'), totalCents: sum('sem_vencimento') },
    items: items.filter((i) => i.situation !== 'depois'),
  };
}
