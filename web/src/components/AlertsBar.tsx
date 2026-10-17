import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { useApp } from '../lib/context';

/** Faixa no topo de todas as telas quando há contas vencidas ou vencendo hoje. */
export default function AlertsBar() {
  const [d, setD] = useState<any>(null);
  const loc = useLocation();
  const owner = useApp().user?.role === 'owner';
  // contas a pagar são da parte de gestão: o funcionário não vê
  useEffect(() => { if (owner) api('GET', '/reports/payables').then(setD).catch(() => setD(null)); else setD(null); }, [loc.pathname, owner]);
  if (!d || (d.overdue.count === 0 && d.dueToday.count === 0) || loc.pathname === '/') return null;
  return (
    <Link to="/" className="no-print mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {d.overdue.count > 0 && <span>{d.overdue.count} conta(s) vencida(s) ({money(d.overdue.totalCents)})</span>}
      {d.overdue.count > 0 && d.dueToday.count > 0 && <span>·</span>}
      {d.dueToday.count > 0 && <span>{d.dueToday.count} vence(m) hoje ({money(d.dueToday.totalCents)})</span>}
      <span className="ml-auto text-xs font-normal underline">ver no Dashboard</span>
    </Link>
  );
}
