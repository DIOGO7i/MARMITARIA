import { useCallback, useEffect, useState } from 'react';
import { api, qs } from '../lib/api';
import { nowLocal, useApp } from '../lib/context';
import { addDays } from '../lib/dates';
import { dateTimeBR, parseMilli, qty, REASON } from '../lib/format';
import { Button, Empty, ErrorBox, Field, PageHeader, useAction, useToast } from '../components/ui';
import { StockBadge } from './Stock';

const OUT = ['consumo', 'perda', 'descarte', 'uso_interno', 'outro'] as const;

export default function StockOut() {
  const { settings, today } = useApp();
  const toast = useToast();
  const [products, setProducts] = useState<any[]>([]);
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState({ from: addDays(today, -30), to: today, reason: '' });
  const n = nowLocal(settings!.timezone);
  const [f, setF] = useState({ productId: '', qty: '', at: `${n.date}T${n.time}`, reason: 'consumo', notes: '' });
  const act = useAction();

  const loadProducts = () => api('GET', '/products?active=1').then(setProducts).catch((e) => setError(e.message));
  const load = useCallback(() => api('GET', '/stock/movements' + qs({ type: 'saida', ...range })).then((r) => { setRows(r); setError(null); }).catch((e) => setError(e.message)), [range]);
  useEffect(() => { loadProducts(); }, []);
  useEffect(() => { load(); }, [load]);

  const p = products.find((x) => String(x.id) === f.productId);
  const q = parseMilli(f.qty);
  const exceeds = p && q && q > p.qtyMilli;

  const submit = () => act.run(async () => {
    if (!p) throw new Error('Escolha o produto.');
    if (!q) throw new Error('Informe uma quantidade válida.');
    if (exceeds) throw new Error(`Quantidade maior que o estoque disponível (${qty(p.qtyMilli)} ${p.unit}). Para corrigir o saldo, use “Ajuste de inventário” na tela Estoque.`);
    if (f.reason === 'outro' && !f.notes.trim()) throw new Error('Descreva o motivo na observação.');
    const r = await api('POST', '/stock/out', { productId: p.id, qtyMilli: q, occurredAt: f.at, reason: f.reason, notes: f.notes });
    toast.ok(`Saída registrada. Novo saldo de ${p.name}: ${qty(r.balanceMilli)} ${p.unit}.`);
    setF({ ...f, qty: '', notes: '' });
    loadProducts(); load();
  });

  return (
    <div>
      <PageHeader title="Saídas de estoque" subtitle="Consumo no preparo, perdas, descarte e uso interno. Pedidos não baixam ingredientes automaticamente." />
      <section className="card mb-4 p-4">
        <h2 className="mb-3 font-bold">Registrar saída</h2>
        <ErrorBox message={act.error} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Produto" className="lg:col-span-2"><select className="input" value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}><option value="">Escolha…</option>{products.map((x) => <option key={x.id} value={x.id}>{x.name} — saldo {qty(x.qtyMilli)} {x.unit}</option>)}</select></Field>
          <Field label={`Quantidade${p ? ` (${p.unit})` : ''}`} error={exceeds ? `Disponível: ${qty(p.qtyMilli)} ${p.unit}` : null}><input className="input" inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
          <Field label="Data e horário"><input type="datetime-local" className="input" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></Field>
          <Field label="Motivo"><select className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{OUT.map((r) => <option key={r} value={r}>{REASON[r]}</option>)}</select></Field>
          <Field label="Observação"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button loading={act.busy} onClick={submit} disabled={!!exceeds}>Registrar saída</Button>
          {p && <StockBadge s={p.stockStatus} />}
        </div>
        {products.length === 0 && <p className="mt-2 text-sm text-slate-500">Nenhum produto ativo. Cadastre produtos e registre compras primeiro.</p>}
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 p-3">
          <h2 className="mr-auto font-bold">Saídas registradas</h2>
          <input aria-label="De" type="date" className="input w-auto!" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <input aria-label="Até" type="date" className="input w-auto!" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          <select aria-label="Motivo" className="input w-auto!" value={range.reason} onChange={(e) => setRange({ ...range, reason: e.target.value })}><option value="">Todo motivo</option>{[...OUT, 'ajuste_inventario', 'cancelamento_compra'].map((r) => <option key={r} value={r}>{REASON[r]}</option>)}</select>
        </div>
        <ErrorBox message={error} />
        {!rows ? <p className="p-4 text-slate-500">Carregando…</p> : rows.length === 0 ? <Empty title="Nenhuma saída no período" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px]">
            <thead className="bg-slate-50"><tr><th className="th">Data/hora</th><th className="th">Produto</th><th className="th text-right">Quantidade</th><th className="th">Motivo</th><th className="th text-right">Saldo após</th><th className="th">Usuário</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map((m) => (
              <tr key={m.id}><td className="td whitespace-nowrap">{dateTimeBR(m.occurredAt)}</td><td className="td">{m.productName}</td><td className="td text-right text-red-700">−{qty(m.outMilli)} {m.unit}</td>
                <td className="td">{REASON[m.reason] ?? m.reason}{m.notes && <div className="text-xs text-slate-500">{m.notes}</div>}</td><td className="td text-right">{qty(m.balanceAfterMilli)} {m.unit}</td><td className="td">{m.userName ?? '—'}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
