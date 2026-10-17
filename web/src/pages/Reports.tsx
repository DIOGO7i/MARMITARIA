import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, qs } from '../lib/api';
import { useApp } from '../lib/context';
import { monthRange } from '../lib/dates';
import { csvDownload, dateBR, money, moneyAxis, qty } from '../lib/format';
import { Button, Empty, ErrorBox, PageHeader } from '../components/ui';
import { StockBadge } from './Stock';
import OptionsSummary from '../components/OptionsSummary';
import PieCard, { CHART_COLORS, useDark } from '../components/PieCard';

type Tab = 'diario' | 'mensal' | 'estoque';
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const LINES: { key: string; label: string; money?: boolean; help?: string }[] = [
  { key: 'registered', label: 'Pedidos registrados' },
  { key: 'delivered', label: 'Pedidos entregues' },
  { key: 'cancelled', label: 'Pedidos cancelados' },
  { key: 'salesCents', label: 'Vendas registradas', money: true, help: 'Valor dos pedidos não cancelados (não é dinheiro recebido)' },
  { key: 'receivedCents', label: 'Valores recebidos', money: true, help: 'Pagamentos de clientes efetivamente recebidos na data' },
  { key: 'receivableCents', label: 'Pendente de recebimento', money: true, help: 'Pedidos do período ainda não pagos' },
  { key: 'deliveryCostCents', label: 'Custo com entregas', money: true, help: 'Pago aos entregadores (informado nos pedidos)' },
  { key: 'deliveryFeeChargedCents', label: 'Frete cobrado dos clientes', money: true },
  { key: 'purchasesCents', label: 'Compras realizadas', money: true },
  { key: 'expensesCents', label: 'Despesas', money: true },
  { key: 'paymentsMadeCents', label: 'Pagamentos realizados', money: true, help: 'Compras e despesas pagas na data' },
  { key: 'payablesPendingCents', label: 'Pagamentos pendentes', money: true, help: 'Compras e despesas do período ainda não pagas' },
];
const val = (s: any, k: string) => (k in s.orders ? s.orders[k] : s[k]);

export default function Reports() {
  const { today, settings } = useApp();
  const [tab, setTab] = useState<Tab>('diario');
  const [day, setDay] = useState(today);
  const [ym, setYm] = useState({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) });
  const mr = monthRange(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  const [sr, setSr] = useState({ from: mr.from, to: mr.to });
  const [loaded, setLoaded] = useState<{ tab: Tab; data: any } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = loaded && loaded.tab === tab ? loaded.data : null; // nunca renderiza dados de outra aba

  const load = useCallback(async () => {
    setLoaded(null); setError(null);
    try {
      let d: any;
      if (tab === 'diario') d = await api('GET', '/reports/summary' + qs({ from: day, to: day }));
      else if (tab === 'mensal') d = await api('GET', '/reports/monthly' + qs({ year: ym.y, month: ym.m }));
      else d = await api('GET', '/reports/stock' + qs(sr));
      setLoaded({ tab, data: d });
    } catch (e: any) { setError(e.message); }
  }, [tab, day, ym, sr]);
  useEffect(() => { load(); }, [load]);

  const header = settings!.establishment.reportHeader || settings!.establishment.name;
  const fmt = (k: string, v: number) => (LINES.find((l) => l.key === k)?.money ? money(v) : String(v));

  const exportCsv = () => {
    if (tab === 'diario' && data) {
      csvDownload(`resumo-diario-${day}.csv`, [[header], [`Resumo diário — ${dateBR(day)}`], ['Indicador', 'Valor'], ...LINES.map((l) => [l.label, fmt(l.key, val(data.summary, l.key))]), [], ['Resultado operacional estimado', money(data.summary.operatingEstimateCents)]]);
    } else if (tab === 'mensal' && data) {
      const c = data.current; const p = data.previous;
      csvDownload(`resumo-mensal-${ym.y}-${String(ym.m).padStart(2, '0')}.csv`, [
        [header], [`Resumo mensal — ${MONTHS[ym.m - 1]}/${ym.y}`], ['Indicador', 'Mês', 'Mês anterior'],
        ...LINES.map((l) => [l.label, fmt(l.key, val(c, l.key)), p ? fmt(l.key, val(p, l.key)) : 'sem dados']),
        ['Resultado operacional estimado', money(c.operatingEstimateCents), p ? money(p.operatingEstimateCents) : 'sem dados'],
        [], ['Data', 'Vendas', 'Recebido', 'Compras', 'Despesas'],
        ...data.series.map((d: any) => [dateBR(d.date), money(d.salesCents), money(d.receivedCents), money(d.purchasesCents), money(d.expensesCents)]),
      ]);
    } else if (tab === 'estoque' && data) {
      csvDownload(`estoque-${sr.from}-a-${sr.to}.csv`, [
        [header], [`Relatório de estoque — movimentações de ${dateBR(sr.from)} a ${dateBR(sr.to)}`], [data.costMethod],
        ['Produto', 'Unidade', 'Quantidade atual', 'Estoque mínimo', 'Custo unitário', 'Valor estimado', 'Situação', 'Entradas no período', 'Saídas no período'],
        ...data.rows.map((r: any) => [r.name, r.unit, qty(r.qtyMilli), qty(r.minQtyMilli), money(r.unitCostCents), money(r.valueCents), r.status === 'ok' ? 'OK' : r.status === 'baixo' ? 'Estoque baixo' : 'Sem estoque', qty(r.inMilli), qty(r.outMilli)]),
        [], ['Valor total estimado', money(data.totalValueCents)],
      ]);
    }
  };

  return (
    <div>
      <PageHeader title="Relatórios" subtitle="Calculados a partir dos registros do sistema"
        actions={<>
          <Button variant="secondary" disabled={!data} onClick={exportCsv}><Download className="h-4 w-4" />CSV</Button>
          <Button variant="secondary" disabled={!data} onClick={() => window.print()}><Printer className="h-4 w-4" />PDF / imprimir</Button>
        </>} />
      <div className="no-print mb-4 flex flex-wrap items-end gap-2">
        {(['diario', 'mensal', 'estoque'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === t ? 'bg-brand-500 text-white' : 'border border-slate-300 bg-white'}`}>
            {t === 'diario' ? 'Resumo diário' : t === 'mensal' ? 'Resumo mensal' : 'Estoque'}
          </button>
        ))}
        <span className="mx-2 hidden h-6 w-px bg-slate-300 sm:block" />
        {tab === 'diario' && <input aria-label="Data" type="date" className="input w-auto!" value={day} onChange={(e) => setDay(e.target.value)} />}
        {tab === 'mensal' && (<>
          <select aria-label="Mês" className="input w-auto!" value={ym.m} onChange={(e) => setYm({ ...ym, m: Number(e.target.value) })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          <input aria-label="Ano" type="number" className="input w-24!" value={ym.y} onChange={(e) => setYm({ ...ym, y: Number(e.target.value) })} />
        </>)}
        {tab === 'estoque' && (<>
          <input aria-label="De" type="date" className="input w-auto!" value={sr.from} onChange={(e) => setSr({ ...sr, from: e.target.value })} />
          <input aria-label="Até" type="date" className="input w-auto!" value={sr.to} onChange={(e) => setSr({ ...sr, to: e.target.value })} />
        </>)}
      </div>
      <ErrorBox message={error} />
      {!data && !error && <p className="text-slate-500">Carregando…</p>}

      <div className="print-area">
        <div className="mb-3 hidden print:block"><div className="text-lg font-bold">{header}</div></div>
        {data && tab === 'diario' && (<>
          <h2 className="mb-2 font-bold">Resumo de {dateBR(day)}</h2>
          <SummaryTable rows={LINES.map((l) => ({ label: l.label, help: l.help, a: fmt(l.key, val(data.summary, l.key)) }))} />
          <Charts s={data.summary} period="do dia" />
          <div className="mt-4"><OptionsSummary data={data.summary.marmitasByOption ?? []} total={data.summary.marmitasTotal ?? 0} /></div>
          <Estimate s={data.summary} />
        </>)}
        {data && tab === 'mensal' && (<>
          <h2 className="mb-2 font-bold">{MONTHS[ym.m - 1]} de {ym.y}</h2>
          <SummaryTable cols={['Mês', 'Mês anterior', 'Variação']} rows={LINES.map((l) => {
            const a = val(data.current, l.key); const b = data.previous ? val(data.previous, l.key) : null;
            return { label: l.label, help: l.help, a: fmt(l.key, a), b: b === null ? 'sem dados' : fmt(l.key, b), c: b === null || b === 0 ? '—' : `${a >= b ? '+' : ''}${(((a - b) / Math.abs(b)) * 100).toFixed(1).replace('.', ',')}%` };
          })} />
          <Charts s={data.current} period="do mês" />
          <Evolution series={data.series} />
          {data.current.expensesByCategory.length > 0 && (
            <section className="card mt-4 p-4"><h3 className="mb-2 font-bold">Despesas por categoria</h3>
              <ul className="divide-y divide-slate-100 text-sm">{data.current.expensesByCategory.map((c: any) => <li key={c.category} className="flex justify-between py-1.5"><span>{c.category}</span><strong>{money(c.totalCents)}</strong></li>)}</ul>
            </section>
          )}
          <Estimate s={data.current} />
        </>)}
        {data && tab === 'estoque' && (<>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="card p-3"><div className="text-xs text-slate-500">Produtos cadastrados</div><div className="text-xl font-bold">{data.rows.length}</div></div>
            <div className="card p-3"><div className="text-xs text-slate-500">Valor estimado</div><div className="text-xl font-bold">{money(data.totalValueCents)}</div></div>
            <div className="card p-3"><div className="text-xs text-slate-500">Abaixo do mínimo</div><div className="text-xl font-bold text-amber-700">{data.belowMin}</div></div>
            <div className="card p-3"><div className="text-xs text-slate-500">Mais movimentado</div><div className="truncate text-xl font-bold">{data.mostMoved[0]?.name ?? '—'}</div></div>
          </div>
          <p className="mb-3 text-xs text-slate-600">ℹ️ {data.costMethod} O valor estimado = quantidade atual × custo médio.</p>
          {data.rows.length === 0 ? <Empty title="Nenhum produto cadastrado" /> : (
            <div className="card overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50"><tr><th className="th">Produto</th><th className="th text-right">Atual</th><th className="th text-right">Mínimo</th><th className="th text-right">Custo médio</th><th className="th text-right">Valor</th><th className="th text-right">Entradas</th><th className="th text-right">Saídas</th><th className="th">Situação</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{data.rows.map((r: any) => (
                <tr key={r.id}><td className="td">{r.name}</td><td className="td text-right">{qty(r.qtyMilli)} {r.unit}</td><td className="td text-right">{qty(r.minQtyMilli)}</td><td className="td text-right">{money(r.unitCostCents)}</td><td className="td text-right">{money(r.valueCents)}</td>
                  <td className="td text-right text-green-700">{r.inMilli ? `+${qty(r.inMilli)}` : '—'}</td><td className="td text-right text-red-700">{r.outMilli ? `−${qty(r.outMilli)}` : '—'}</td><td className="td"><StockBadge s={r.status} /></td></tr>
              ))}</tbody>
            </table></div>
          )}
          {data.mostMoved.length > 0 && <section className="card mt-4 p-4"><h3 className="mb-2 font-bold">Produtos mais movimentados no período</h3>
            <ol className="list-decimal pl-5 text-sm">{data.mostMoved.map((m: any) => <li key={m.id}>{m.name} — {m.movements} movimentação(ões)</li>)}</ol></section>}
        </>)}
      </div>
    </div>
  );
}

/** Os 4 gráficos de pizza do período (dia ou mês). */
const MODE_KEY = 'marmitaria.graficos';
const readMode = (k: string, def: string) => { try { return localStorage.getItem(k) || def; } catch { return def; } };
const saveMode = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento: só não lembra */ } };

/** Botões pequenos para escolher o jeito de ver (lembra a escolha neste aparelho). */
function Toggle<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="no-print inline-flex rounded-lg border border-slate-300 p-0.5 text-xs font-semibold" role="group" aria-label={label}>
      {options.map(([k, t]) => <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
        className={`rounded-md px-2.5 py-1 ${value === k ? 'bg-brand-500 text-white' : 'text-slate-600'}`}>{t}</button>)}
    </div>
  );
}

function Charts({ s, period }: { s: any; period: string }) {
  const [by, setBy] = useState<'opcao' | 'tamanho'>('opcao');
  const [mode, setModeState] = useState<'pizza' | 'colunas'>(() => (readMode(MODE_KEY, 'pizza') === 'colunas' ? 'colunas' : 'pizza'));
  const setMode = (m: 'pizza' | 'colunas') => { setModeState(m); saveMode(MODE_KEY, m); };
  const c = s.charts;
  if (!c) return null;
  const marm = (by === 'opcao' ? c.marmitasByOption : c.marmitasBySize).map((x: any) => ({ label: x.label, value: x.qty }));
  return (<>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Gráficos {period}</h3>
      <Toggle label="Tipo de gráfico" value={mode} onChange={setMode} options={[['pizza', 'Pizza'], ['colunas', 'Colunas']]} />
    </div>
    <div className="mt-2 grid gap-4 lg:grid-cols-2 print:grid-cols-2">
      <PieCard mode={mode} title="Para onde vai o dinheiro" subtitle={`Compras, despesas e entregadores ${period}`} kind="money"
        slices={c.spending.map((x: any) => ({ label: x.label, value: x.cents }))} empty="Nenhuma compra ou despesa no período." />
      <PieCard mode={mode} title="Como os clientes pagaram" subtitle={`Recebido ${period}, por forma de pagamento`} kind="money"
        slices={c.receivedByMethod.map((x: any) => ({ label: x.label, value: x.cents }))} empty="Nenhum recebimento no período." />
      <PieCard mode={mode} title="Marmitas vendidas" subtitle={`Sem contar pedidos cancelados`} kind="count" unit={['marmita', 'marmitas']} slices={marm} empty="Nenhuma marmita no período."
        extra={<Toggle label="Agrupar marmitas" value={by} onChange={setBy} options={[['opcao', 'Por opção'], ['tamanho', 'Por tamanho']]} />} />
      <PieCard mode={mode} title="Retirada x entrega" subtitle="Quantidade de pedidos, sem contar cancelados" kind="count" unit={['pedido', 'pedidos']}
        slices={c.deliveryTypes.map((x: any) => ({ label: x.label, value: x.qty }))} empty="Nenhum pedido no período." />
    </div>
  </>);
}

/** Evolução do mês: linhas (como era) ou colunas de vendas x gastos por dia. */
function Evolution({ series }: { series: any[] }) {
  const dark = useDark();
  const pal = dark ? CHART_COLORS.dark : CHART_COLORS.light;
  const [mode, setModeState] = useState<'linhas' | 'colunas'>(() => (readMode(MODE_KEY + '.mes', 'colunas') === 'linhas' ? 'linhas' : 'colunas'));
  const setMode = (m: 'linhas' | 'colunas') => { setModeState(m); saveMode(MODE_KEY + '.mes', m); };
  const grid = dark ? '#44403c' : '#e7e5e4'; const ink = dark ? '#a8a29e' : '#78716c';
  const tip = { contentStyle: { borderRadius: 8, fontSize: 13, background: dark ? '#292524' : '#fff', border: `1px solid ${grid}`, color: dark ? '#f5f5f4' : '#1c1917' } };
  return (
    <section className="card mt-4 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">Evolução diária</h3>
        <Toggle label="Tipo de gráfico do mês" value={mode} onChange={setMode} options={[['colunas', 'Colunas'], ['linhas', 'Linhas']]} />
      </div>
      <div className="h-72"><ResponsiveContainer width="100%" height="100%">
        {mode === 'colunas' ? (
          <BarChart data={series.map((d: any) => ({ dia: d.date.slice(8), Vendas: d.salesCents / 100, Gastos: (d.purchasesCents + d.expensesCents) / 100 }))} barGap={2}>
            <CartesianGrid vertical={false} stroke={grid} />
            <XAxis dataKey="dia" fontSize={11} tickLine={false} tick={{ fill: ink }} axisLine={{ stroke: grid }} interval="preserveStartEnd" />
            <YAxis fontSize={11} width={80} tickFormatter={moneyAxis} tickLine={false} axisLine={false} tick={{ fill: ink }} />
            <Tooltip {...tip} cursor={{ fill: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }} formatter={(v: number) => money(Math.round(v * 100))} labelFormatter={(l) => `Dia ${l}`} />
            <Legend wrapperStyle={{ fontSize: 13 }} formatter={(v) => <span style={{ color: dark ? '#d6d3d1' : '#44403c' }}>{v}</span>} />
            <Bar dataKey="Vendas" fill={pal[0]} maxBarSize={12} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="Gastos" name="Gastos (compras + despesas)" fill={pal[1]} maxBarSize={12} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        ) : (
          <LineChart data={series.map((d: any) => ({ dia: d.date.slice(8), Vendas: d.salesCents / 100, Recebido: d.receivedCents / 100, Compras: d.purchasesCents / 100, Despesas: d.expensesCents / 100 }))}>
            <CartesianGrid strokeDasharray="3 3" stroke={grid} /><XAxis dataKey="dia" fontSize={12} tick={{ fill: ink }} /><YAxis fontSize={12} width={72} tickFormatter={moneyAxis} tick={{ fill: ink }} />
            <Tooltip {...tip} formatter={(v: number) => money(Math.round(v * 100))} labelFormatter={(l) => `Dia ${l}`} /><Legend formatter={(v) => <span style={{ color: dark ? '#d6d3d1' : '#44403c' }}>{v}</span>} />
            <Line type="monotone" dataKey="Vendas" stroke={pal[0]} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Recebido" stroke={pal[2]} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Compras" stroke={pal[1]} strokeWidth={2} dot={false} strokeDasharray="5 3" />
            <Line type="monotone" dataKey="Despesas" stroke={pal[7]} strokeWidth={2} dot={false} strokeDasharray="2 2" />
          </LineChart>
        )}
      </ResponsiveContainer></div>
    </section>
  );
}

function SummaryTable({ rows, cols = ['Valor'] }: { rows: { label: string; help?: string; a: ReactNode; b?: ReactNode; c?: ReactNode }[]; cols?: string[] }) {
  return (
    <div className="card overflow-x-auto"><table className="w-full text-sm">
      <thead className="bg-slate-50"><tr><th className="th">Indicador</th>{cols.map((c) => <th key={c} className="th text-right">{c}</th>)}</tr></thead>
      <tbody className="divide-y divide-slate-100">{rows.map((r) => (
        <tr key={r.label}><td className="td">{r.label}{r.help && <div className="text-xs text-slate-500">{r.help}</div>}</td>
          <td className="td text-right font-semibold">{r.a}</td>{cols.length > 1 && <td className="td text-right">{r.b}</td>}{cols.length > 2 && <td className="td text-right">{r.c}</td>}</tr>
      ))}</tbody>
    </table></div>
  );
}

function Estimate({ s }: { s: any }) {
  return (
    <section className="card mt-4 p-4">
      <h3 className="font-bold">Resultado operacional <span className="text-amber-700">(estimativa)</span>: {money(s.operatingEstimateCents)}</h3>
      <p className="mt-1 text-sm text-slate-600">
        Vendas {money(s.salesCents)} − custo das entregas {money(s.deliveryCostCents)} − despesas {money(s.expensesCents - s.courierExpensesCents)} − insumos baixados do estoque {money(s.consumptionCostCents)}.
        As compras não são subtraídas diretamente: elas viram custo quando os insumos saem do estoque (consumo, perda, descarte, uso interno), pelo custo médio.
      </p>
      {s.estimateMissing.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-amber-800">{s.estimateMissing.map((m: string) => <li key={m}>{m}</li>)}</ul>}
    </section>
  );
}
