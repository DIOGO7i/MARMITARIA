import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import { api } from '../lib/api';
import { dateBR, money } from '../lib/format';
import { Badge } from './ui';

const SIT: Record<string, { label: string; cls: string }> = {
  vencida: { label: '⚠ Vencida', cls: 'bg-red-100 text-red-800' },
  hoje: { label: '⏰ Vence hoje', cls: 'bg-amber-100 text-amber-800' },
  em_breve: { label: 'Em breve', cls: 'bg-blue-100 text-blue-800' },
  sem_vencimento: { label: 'Sem vencimento', cls: 'bg-slate-200 text-slate-700' },
};

export default function PayablesCard() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api('GET', '/reports/payables').then(setD).catch(() => setD(null)); }, []);
  if (!d) return null;
  const list = d.items.filter((i: any) => i.situation !== 'sem_vencimento');
  return (
    <section className="card p-4">
      <h2 className="mb-3 flex items-center gap-2 font-bold"><CalendarClock className="h-5 w-5" />Contas a pagar</h2>
      <div className="mb-3 grid grid-cols-3 gap-2 text-center text-sm">
        <div className={`rounded-lg p-2 ${d.overdue.count ? 'bg-red-50 text-red-800' : 'bg-slate-50'}`}><div className="text-xs">Vencidas</div><div className="font-bold">{d.overdue.count} · {money(d.overdue.totalCents)}</div></div>
        <div className={`rounded-lg p-2 ${d.dueToday.count ? 'bg-amber-50 text-amber-800' : 'bg-slate-50'}`}><div className="text-xs">Vencem hoje</div><div className="font-bold">{d.dueToday.count} · {money(d.dueToday.totalCents)}</div></div>
        <div className="rounded-lg bg-slate-50 p-2"><div className="text-xs">Próximos {d.days} dias</div><div className="font-bold">{d.dueSoon.count} · {money(d.dueSoon.totalCents)}</div></div>
      </div>
      {list.length === 0 ? <p className="text-sm text-slate-500">Nenhuma conta vencida ou vencendo nos próximos {d.days} dias. 👍</p> : (
        <ul className="divide-y divide-slate-100 text-sm">
          {list.slice(0, 8).map((i: any) => (
            <li key={i.type + i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link to={i.type === 'compra' ? '/compras' : '/despesas'} className="min-w-0 flex-1 hover:underline">
                <div className="truncate">{i.description}</div><div className="text-xs text-slate-500">{i.type === 'compra' ? 'Compra' : 'Despesa'} · vence {dateBR(i.dueDate)}</div>
              </Link>
              <Badge cls={SIT[i.situation].cls}>{SIT[i.situation].label}</Badge>
              <strong className="w-24 text-right">{money(i.openCents)}</strong>
            </li>
          ))}
        </ul>
      )}
      {d.noDue.count > 0 && <p className="mt-2 text-xs text-slate-500">{d.noDue.count} conta(s) em aberto sem data de vencimento ({money(d.noDue.totalCents)}).</p>}
    </section>
  );
}
