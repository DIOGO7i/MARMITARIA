export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const monthRange = (year: number, month: number) => {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` };
};
export type PeriodKey = 'hoje' | '7dias' | 'mes' | 'mes_anterior' | 'custom';
export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'hoje', label: 'Hoje' }, { key: '7dias', label: 'Últimos 7 dias' }, { key: 'mes', label: 'Este mês' },
  { key: 'mes_anterior', label: 'Mês anterior' }, { key: 'custom', label: 'Personalizado' },
];
export function periodRange(key: PeriodKey, today: string, custom: { from: string; to: string }) {
  const y = Number(today.slice(0, 4)); const m = Number(today.slice(5, 7));
  switch (key) {
    case 'hoje': return { from: today, to: today };
    case '7dias': return { from: addDays(today, -6), to: today };
    case 'mes': return monthRange(y, m);
    case 'mes_anterior': return m === 1 ? monthRange(y - 1, 12) : monthRange(y, m - 1);
    default: return custom;
  }
}
