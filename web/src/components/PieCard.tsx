import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money, moneyAxis } from '../lib/format';

// Paleta categórica (ordem fixa, validada para daltonismo nos dois temas). A cor segue a fatia pela posição no ranking do período.
const LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const OTHER = { light: '#a8a29e', dark: '#78716c' }; // "Outros" em cinza, para não parecer mais uma categoria

export function useDark() {
  const get = () => document.documentElement.classList.contains('dark');
  const [dark, setDark] = useState(get);
  useEffect(() => {
    const o = new MutationObserver(() => setDark(get()));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => o.disconnect();
  }, []);
  return dark;
}

export interface Slice { label: string; value: number }

/** Gráfico de pizza (rosca) com a lista ao lado: cada fatia tem nome, valor e porcentagem escritos, não só a cor. */
export const CHART_COLORS = { light: LIGHT, dark: DARK };

/** Nome embaixo da coluna, quebrado em até 2 linhas (nomes compridos como "Compras de mercadoria" não se atropelam). */
function WrapTick({ x, y, payload, dark, width }: any) {
  const words = String(payload.value).split(' ');
  const lines: string[] = [''];
  const max = Math.max(6, Math.floor((width ?? 80) / 6.5));
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (!cur) lines[lines.length - 1] = w;
    else if ((cur + ' ' + w).length <= max) lines[lines.length - 1] = cur + ' ' + w;
    else if (lines.length < 2) lines.push(w);
    else { lines[1] = (lines[1] + ' ' + w).slice(0, max - 1) + '…'; break; }
  }
  return (
    <text x={x} y={y + 12} textAnchor="middle" fontSize={11} fill={dark ? '#d6d3d1' : '#57534e'}>
      {lines.map((l, i) => <tspan key={i} x={x} dy={i ? 13 : 0}>{l.length > max ? l.slice(0, max - 1) + '…' : l}</tspan>)}
    </text>
  );
}

export default function PieCard({ title, subtitle, slices, kind, empty, extra, unit, mode = 'pizza' }: {
  title: string; subtitle?: string; slices: Slice[]; kind: 'money' | 'count'; empty: string; extra?: React.ReactNode; unit?: [string, string]; mode?: 'pizza' | 'colunas';
}) {
  const dark = useDark();
  const pal = dark ? DARK : LIGHT;
  const sorted = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  // até 7 fatias com nome; o resto vira "Outros"
  const shown = sorted.length > 8 ? [...sorted.slice(0, 7), { label: 'Outros', value: sorted.slice(7).reduce((a, s) => a + s.value, 0) }] : sorted;
  const total = shown.reduce((a, s) => a + s.value, 0);
  const color = (s: Slice, i: number) => (s.label === 'Outros' && sorted.length > 8 ? OTHER[dark ? 'dark' : 'light'] : pal[i]);
  const fmt = (v: number) => (kind === 'money' ? money(v) : `${v} ${unit ? (v === 1 ? unit[0] : unit[1]) : ''}`.trim());
  const pct = (v: number) => `${((v / total) * 100).toFixed(total && v / total < 0.1 ? 1 : 0).replace('.', ',')}%`;

  const list = (
    <ul className={`w-full min-w-0 space-y-1 text-sm ${mode === 'colunas' ? 'mt-2' : 'flex-1'}`}>
            {shown.map((s, i) => (
              <li key={s.label} className="flex items-start gap-2">
                <span className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ background: color(s, i) }} aria-hidden />
                <span className="min-w-0 flex-1 leading-tight break-words">{s.label}</span>
                <span className="shrink-0 tabular-nums text-slate-600">{fmt(s.value)}</span>
                <span className="w-12 shrink-0 text-right font-semibold tabular-nums">{pct(s.value)}</span>
              </li>
            ))}
          </ul>
  );
  return (
    <section className="card p-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="font-bold">{title}</h3>{subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}</div>
        {extra}
      </div>
      {total === 0 ? <p className="py-6 text-center text-sm text-slate-500">{empty}</p> : mode === 'colunas' ? (
        <div><div className="h-60" role="img" aria-label={`${title}: ${shown.map((s) => `${s.label} ${fmt(s.value)} (${pct(s.value)})`).join(', ')}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={shown} margin={{ top: 20, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={dark ? '#44403c' : '#e7e5e4'} />
              <XAxis dataKey="label" interval={0} height={36} tickLine={false} axisLine={{ stroke: dark ? '#57534e' : '#d6d3d1' }}
                tick={(p: any) => <WrapTick {...p} dark={dark} width={p.width / Math.max(shown.length, 1)} />} />
              <YAxis width={kind === 'money' ? 76 : 32} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false}
                tick={{ fill: dark ? '#a8a29e' : '#78716c' }} tickFormatter={kind === 'money' ? (v: number) => moneyAxis(v / 100) : undefined} />
              <Tooltip cursor={{ fill: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }} formatter={(v: number) => [`${fmt(v)} · ${pct(v)}`, '']} separator=""
                contentStyle={{ borderRadius: 8, fontSize: 13, background: dark ? '#292524' : '#fff', border: `1px solid ${dark ? '#44403c' : '#e7e5e4'}`, color: dark ? '#f5f5f4' : '#1c1917' }}
                labelStyle={{ fontWeight: 600 }} itemStyle={{ color: dark ? '#f5f5f4' : '#1c1917' }} />
              <Bar dataKey="value" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {shown.map((s, i) => <Cell key={s.label} fill={color(s, i)} />)}
                <LabelList dataKey="value" position="top" fontSize={11} fill={dark ? '#e7e5e4' : '#44403c'} formatter={(v: number) => pct(v)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer></div>
          {list}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
          <div className="relative h-44 w-44 shrink-0" role="img" aria-label={`${title}: ${shown.map((s) => `${s.label} ${fmt(s.value)} (${pct(s.value)})`).join(', ')}`}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={shown} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="100%" startAngle={90} endAngle={-270}
                  stroke={dark ? '#1c1917' : '#ffffff'} strokeWidth={2} isAnimationActive={false}>
                  {shown.map((s, i) => <Cell key={s.label} fill={color(s, i)} />)}
                </Pie>
                <Tooltip formatter={(v: number, n: string) => [`${fmt(v)} · ${pct(v)}`, n]}
                  contentStyle={{ borderRadius: 8, fontSize: 13, background: dark ? '#292524' : '#fff', border: `1px solid ${dark ? '#44403c' : '#e7e5e4'}`, color: dark ? '#f5f5f4' : '#1c1917' }}
                  itemStyle={{ color: dark ? '#f5f5f4' : '#1c1917' }} />
              </PieChart>
            </ResponsiveContainer>
            {/* total no meio da rosca */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-[11px] text-slate-500">Total</span>
              <span className={`font-bold ${kind === 'money' && total >= 1_000_000 ? 'text-xs' : 'text-sm'}`}>{fmt(total)}</span>
            </div>
          </div>
          {list}
        </div>
      )}
    </section>
  );
}
