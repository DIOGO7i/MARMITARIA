import { useEffect, useState } from 'react';
import { Bike, Loader2, MapPinOff } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useApp } from '../lib/context';
import { money } from '../lib/format';

export type DistanceState = { k: 'idle' } | { k: 'loading' } | { k: 'off' } | { k: 'ok'; meters: number; seconds: number; approximate: boolean } | { k: 'none'; reason: string } | { k: 'err'; msg: string };
export interface Tier { upToMeters: number; feeCents: number; costCents: number }

const cache = new Map<string, DistanceState>(); // evita repetir a mesma consulta enquanto a tela está aberta
let disabled = false;                              // sem chave do mapa: não fica perguntando de novo

export const kmText = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
export const minText = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;
/** Faixa de frete para a distância (a primeira faixa que cobre). null = passou da maior faixa (ou não há faixas). */
export const tierFor = (tiers: Tier[] | undefined, meters: number) => (tiers ?? []).find((t) => meters <= t.upToMeters) ?? null;

/** Distância do restaurante até o endereço (pelas ruas). Espera a pessoa parar de digitar antes de consultar. */
export function useDistance(street: string, neighborhood?: string | null): DistanceState {
  const s = street.trim(); const n = (neighborhood ?? '').trim();
  const key = `${s}|${n}`.toLowerCase();
  const [st, setSt] = useState<DistanceState>(() => cache.get(key) ?? { k: 'idle' });

  useEffect(() => {
    if (disabled) { setSt({ k: 'off' }); return; }
    // precisa ter rua e algum número para valer a pena consultar
    if (s.length < 5 || !/\d/.test(s)) { setSt({ k: 'idle' }); return; }
    const hit = cache.get(key);
    if (hit) { setSt(hit); return; }
    let alive = true;
    setSt({ k: 'loading' });
    const t = setTimeout(async () => {
      try {
        const r = await api('GET', '/distance' + qs({ street: s, neighborhood: n || undefined }));
        const v: DistanceState = !r.enabled ? { k: 'off' } : r.found ? { k: 'ok', meters: r.meters, seconds: r.seconds, approximate: r.approximate } : { k: 'none', reason: r.reason };
        if (!r.enabled) disabled = true;
        if (v.k !== 'off') cache.set(key, v);
        if (alive) setSt(v);
      } catch (e: any) { if (alive) setSt({ k: 'err', msg: e.message }); }
    }, 600);
    return () => { alive = false; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return st;
}

/** Selo com distância, tempo e o frete da faixa (Configurações → Taxa de entrega pela distância). */
export function DistanceView({ st, compact }: { st: DistanceState; compact?: boolean }) {
  const { settings } = useApp();
  if (st.k === 'idle' || st.k === 'off') return null;
  const base = `inline-flex flex-wrap items-center gap-1.5 rounded-full font-semibold ${compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'}`;
  if (st.k === 'loading') return <span className={`${base} bg-slate-100 text-slate-600`} role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" />Calculando distância…</span>;
  if (st.k === 'ok') {
    const tiers = settings?.deliveryTiers ?? [];
    const t = tierFor(tiers, st.meters);
    return (
      <span className={`${base} ${st.approximate ? 'bg-amber-100 text-amber-900' : 'bg-brand-100 text-brand-800'}`} role="status" title="Distância pelas ruas, a partir do restaurante, sem contar trânsito">
        <Bike className="h-3.5 w-3.5" />{kmText(st.meters)} · ~{minText(st.seconds)}
        {tiers.length > 0 && (t ? <> · frete {money(t.feeCents)}</> : <> · fora das faixas de frete</>)}
        {st.approximate && ' (aproximado: confira o número)'}
      </span>
    );
  }
  return <span className={`${base} bg-red-50 text-red-700`} role="status"><MapPinOff className="h-3.5 w-3.5" />{st.k === 'none' ? st.reason : st.msg}</span>;
}

export default function DistanceBadge({ street, neighborhood, compact }: { street: string; neighborhood?: string | null; compact?: boolean }) {
  const st = useDistance(street, neighborhood);
  return <DistanceView st={st} compact={compact} />;
}
