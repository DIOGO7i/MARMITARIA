import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { milliToInput, money, parseMilli } from '../lib/format';
import { Badge, Button, Empty, ErrorBox, Field, PageHeader, useAction, useToast } from '../components/ui';

const MOMENTS: Record<string, string> = {
  entregue: 'Quando o pedido for entregue (recomendado)',
  saiu_para_entrega: 'Quando sair para entrega',
  pronto: 'Quando ficar pronto',
  em_preparo: 'Quando começar o preparo',
  desativado: 'Não baixar automaticamente',
};

export default function Recipes() {
  const { settings, reloadSettings, user } = useApp();
  const toast = useToast();
  const owner = user?.role === 'owner';
  const [data, setData] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cfg = useAction();
  const [moment, setMoment] = useState(settings!.stockDeductOn);
  const [minPct, setMinPct] = useState(String(settings!.minMarginPct));

  const load = useCallback(() => Promise.all([api('GET', '/recipes'), api('GET', '/products?active=1')])
    .then(([r, p]) => { setData(r); setProducts(p); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const saveCfg = () => cfg.run(async () => {
    const pct = Number(minPct.replace(',', '.'));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error('Lucro mínimo deve ser entre 0 e 100%.');
    const { timezone: _tz, ...rest } = settings!;
    await api('PUT', '/settings', { ...rest, stockDeductOn: moment, minMarginPct: pct });
    await reloadSettings(); await load();
    toast.ok('Configuração da ficha técnica salva.');
  });

  return (
    <div className="max-w-5xl">
      <PageHeader title="Fichas técnicas" subtitle="O que vai em cada marmita: custo real, lucro e baixa automática do estoque" />
      <ErrorBox message={error} />

      <section className="card mb-4 grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <ErrorBox message={cfg.error} />
        <Field label="Baixar ingredientes do estoque" hint="Cada pedido baixa uma única vez. Se for cancelado ou voltar de status, o estoque é devolvido.">
          <select className="input" disabled={!owner} value={moment} onChange={(e) => setMoment(e.target.value as any)}>{Object.entries(MOMENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="Avisar se o lucro ficar abaixo de (%)"><input className="input sm:w-28!" disabled={!owner} inputMode="decimal" value={minPct} onChange={(e) => setMinPct(e.target.value)} /></Field>
        {owner && <Button loading={cfg.busy} onClick={saveCfg}>Salvar</Button>}
      </section>

      {!data ? <p className="text-slate-500">Carregando…</p> : products.length === 0 ? (
        <div className="card"><Empty title="Cadastre os ingredientes primeiro" hint="As fichas usam os produtos do estoque. Importe uma nota fiscal em “Compras e entradas” ou cadastre em “Estoque”." /></div>
      ) : (
        <div className="space-y-4">
          {data.sizes.map((s: any) => <RecipeCard key={s.size} r={s} products={products} owner={owner} onSaved={(d) => { setData(d); toast.ok(`Ficha da marmita ${s.size} salva.`); }} />)}
        </div>
      )}
      <p className="mt-4 text-xs text-slate-500">O custo usa o custo médio de cada ingrediente, que é atualizado a cada compra. Por isso, quando o fornecedor aumenta o preço, o lucro aqui muda sozinho.</p>
    </div>
  );
}

interface Line { productId: string; qty: string }

function RecipeCard({ r, products, owner, onSaved }: { r: any; products: any[]; owner: boolean; onSaved: (d: any) => void }) {
  const [lines, setLines] = useState<Line[]>(() => r.items.map((i: any) => ({ productId: String(i.productId), qty: milliToInput(i.qtyMilli) })));
  const [dirty, setDirty] = useState(false);
  const act = useAction();
  useEffect(() => { setLines(r.items.map((i: any) => ({ productId: String(i.productId), qty: milliToInput(i.qtyMilli) }))); setDirty(false); }, [r]);
  const set = (i: number, p: Partial<Line>) => { setDirty(true); setLines((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x))); };

  // custo calculado na hora, enquanto edita
  const calc = lines.map((l) => {
    const p = products.find((x) => String(x.id) === l.productId);
    const q = parseMilli(l.qty);
    return { p, q, cost: p && q ? Math.round((q * p.unitCostCents) / 1000) : 0 };
  });
  const cost = dirty ? calc.reduce((a, c) => a + c.cost, 0) : r.costCents;
  const margin = r.priceCents - cost;
  const pct = r.priceCents ? Math.round((margin / r.priceCents) * 1000) / 10 : 0;

  const save = () => act.run(async () => {
    const items = lines.filter((l) => l.productId || l.qty).map((l, i) => {
      const q = parseMilli(l.qty);
      if (!l.productId) throw new Error(`Linha ${i + 1}: escolha o ingrediente.`);
      if (!q) throw new Error(`Linha ${i + 1}: quantidade inválida.`);
      return { productId: Number(l.productId), qtyMilli: q };
    });
    onSaved(await api('PUT', `/recipes/${encodeURIComponent(r.size)}`, { items }));
  });

  const unitHint = (unit: string, q: number | null) => {
    if (!q) return '';
    if (unit === 'kg') return `= ${q} g`;
    if (unit === 'litro') return `= ${Math.round(q)} ml`;
    return '';
  };

  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Marmita {r.size}</h2>
          <p className="text-sm text-slate-500">Preço de venda: {money(r.priceCents)}</p>
        </div>
        {lines.length > 0 ? (
          <div className="grid grid-cols-3 gap-4 text-right text-sm">
            <div><div className="text-xs text-slate-500">Custo</div><div className="text-lg font-bold">{money(cost)}</div></div>
            <div><div className="text-xs text-slate-500">Lucro</div><div className={`text-lg font-bold ${margin < 0 ? 'text-red-700' : 'text-green-700'}`}>{money(margin)}</div></div>
            <div><div className="text-xs text-slate-500">Margem</div><div className={`text-lg font-bold ${r.lowMargin && !dirty ? 'text-red-700' : ''}`}>{pct.toString().replace('.', ',')}%</div></div>
          </div>
        ) : <Badge cls="bg-slate-200 text-slate-700">Sem ficha: este tamanho não baixa estoque</Badge>}
      </div>
      {!dirty && r.lowMargin && <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-700"><AlertTriangle className="h-4 w-4" />Lucro abaixo do mínimo configurado. Reveja o preço ou a receita.</p>}
      {!dirty && r.missingCost && <p className="mb-2 text-sm text-amber-700">Algum ingrediente está com custo R$ 0,00 (ainda sem compra registrada). O custo da marmita pode estar menor do que o real.</p>}
      <ErrorBox message={act.error} />
      <div className="space-y-2">
        {lines.map((l, i) => {
          const c = calc[i];
          return (
            <div key={i} className="grid grid-cols-12 items-end gap-2">
              <Field label="Ingrediente" className="col-span-12 sm:col-span-6">
                <select className="input" disabled={!owner} value={l.productId} onChange={(e) => set(i, { productId: e.target.value })}>
                  <option value="">Escolha…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
                </select>
              </Field>
              <Field label={`Por marmita${c.p ? ` (${c.p.unit})` : ''}`} className="col-span-5 sm:col-span-3" hint={c.p ? unitHint(c.p.unit, c.q) : undefined}>
                <input className="input" disabled={!owner} inputMode="decimal" placeholder={c.p?.unit === 'kg' ? 'ex.: 0,150' : ''} value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />
              </Field>
              <div className="col-span-5 pb-2 text-right text-sm sm:col-span-2">{money(c.cost)}</div>
              <div className="col-span-2 flex justify-end pb-1 sm:col-span-1">{owner && <button type="button" onClick={() => { setDirty(true); setLines((x) => x.filter((_, j) => j !== i)); }} className="rounded-sm p-2 text-red-600 hover:bg-red-50" aria-label="Remover ingrediente"><Trash2 className="h-4 w-4" /></button>}</div>
            </div>
          );
        })}
      </div>
      {owner && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { setDirty(true); setLines((l) => [...l, { productId: '', qty: '' }]); }}><Plus className="h-4 w-4" />Adicionar ingrediente</Button>
          {dirty && <Button loading={act.busy} onClick={save}>Salvar ficha</Button>}
          {dirty && <Button variant="ghost" onClick={() => { setLines(r.items.map((i: any) => ({ productId: String(i.productId), qty: milliToInput(i.qtyMilli) }))); setDirty(false); }}>Desfazer</Button>}
        </div>
      )}
    </section>
  );
}
