import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChefHat, MessageCircle, PackageX, Pencil, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { money } from '../lib/format';
import { DayMenuOption, menuText, SwapGroup, waShare, weekdayBR } from '../lib/whatsapp';
import { Button, ErrorBox, PageHeader, Stat, useToast } from '../components/ui';
import PayablesCard from '../components/PayablesCard';
import OptionsSummary from '../components/OptionsSummary';

/** Tela inicial: só o que importa hoje — cardápio, pedidos, dinheiro e o que está acabando. Períodos ficam em Relatórios. */
export default function Dashboard() {
  const { today, settings, user } = useApp();
  const owner = user?.role === 'owner';
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [menu, setMenu] = useState<{ saved: boolean; options: DayMenuOption[]; swaps?: SwapGroup[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyOpt, setBusyOpt] = useState<string | null>(null);
  const [lowMargin, setLowMargin] = useState<any[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, m] = await Promise.all([api('GET', `/reports/dashboard?from=${today}&to=${today}`), api('GET', `/menu/${today}`)]);
      setData(d); setMenu(m);
    } catch (e: any) { setError(e.message); }
  }, [today]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (owner && settings?.modules.fichas) api('GET', '/recipes').then((r) => setLowMargin(r.sizes.filter((x: any) => x.lowMargin))).catch(() => {});
  }, [owner, settings?.modules.fichas]);

  const soldOut = async (o: DayMenuOption) => {
    setBusyOpt(o.name);
    try {
      const m = await api('POST', `/menu/${today}/sold-out`, { name: o.name, soldOut: !o.soldOut });
      setMenu(m);
      toast.ok(o.soldOut ? `${o.name} voltou para o cardápio.` : `${o.name} marcada como esgotada.`);
    } catch (e: any) { toast.err(e.message); }
    finally { setBusyOpt(null); }
  };

  const s = data?.summary;
  return (
    <div>
      <PageHeader title="Hoje" subtitle={weekdayBR(today).replace(/^./, (c) => c.toUpperCase())}
        actions={<Link to="/pedidos?novo=1" className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 text-base font-semibold text-white hover:bg-brand-600"><Plus className="h-5 w-5" />Novo pedido</Link>} />

      {lowMargin.length > 0 && (
        <Link to="/fichas" className="no-print mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <span><strong>Lucro abaixo do mínimo:</strong> {lowMargin.map((x) => `marmita ${x.size} (${String(x.marginPct).replace('.', ',')}%)`).join(', ')}. Clique para ver a ficha técnica.</span>
        </Link>
      )}

      <ErrorBox message={error} />
      {error && <Button variant="secondary" onClick={load}>Tentar novamente</Button>}
      {!data && !error && <p className="text-slate-500">Carregando…</p>}

      {menu && (
        !menu.saved ? (
          <Link to="/cardapio" className="mb-4 flex items-center gap-3 rounded-xl border-2 border-dashed border-brand-500 bg-brand-50 p-4 text-brand-800">
            <ChefHat className="h-8 w-8 shrink-0" />
            <span><strong className="block text-base">Montar o cardápio de hoje</strong><span className="text-sm">Diga o que vai em cada opção antes do movimento começar. Leva um minuto.</span></span>
          </Link>
        ) : (
          <section className="card mb-4 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-bold"><ChefHat className="h-5 w-5" />Cardápio de hoje</h2>
              <div className="flex gap-2">
                <a href={waShare(menuText(menu.options, settings!, today, today, menu.swaps ?? []))} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-green-600 px-3 py-1.5 text-sm font-semibold text-green-700 hover:bg-green-50"><MessageCircle className="h-4 w-4" />Mandar no WhatsApp</a>
                <Link to="/cardapio" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold hover:bg-slate-50"><Pencil className="h-4 w-4" />Editar</Link>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {menu.options.map((o) => (
                <div key={o.name} className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${o.soldOut ? 'border-red-200 bg-red-50' : 'border-slate-200'}`}>
                  <div className="min-w-0">
                    <div className="font-bold">{o.name}{o.soldOut && <span className="ml-2 rounded-sm bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">Esgotou</span>}</div>
                    <div className="text-sm text-slate-600">{o.description || <span className="italic text-slate-400">sem descrição</span>}</div>
                  </div>
                  <Button variant="secondary" className="shrink-0 px-2.5! py-1.5! text-xs" loading={busyOpt === o.name} onClick={() => soldOut(o)}>
                    {o.soldOut ? 'Voltou' : 'Esgotou'}
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )
      )}

      {s && (
        <>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Pedidos de hoje</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Link to="/pedidos"><Stat label="Pendentes" value={s.orders.pending} tone={s.orders.pending ? 'warn' : 'default'} /></Link>
            <Link to="/pedidos"><Stat label="Em preparo" value={s.orders.preparing} /></Link>
            <Link to="/pedidos"><Stat label="Prontos" value={s.orders.ready} sub="Esperando retirada ou entregador" /></Link>
            <Link to="/pedidos"><Stat label="Saiu para entrega" value={s.orders.onTheWay} /></Link>
            <Link to="/pedidos" className="col-span-2 md:col-span-1"><Stat label="Entregues / retirados" value={s.orders.delivered} tone="good" sub={s.orders.cancelled ? `${s.orders.cancelled} cancelado(s)` : undefined} /></Link>
          </div>

          <div className="mt-4"><OptionsSummary data={s.marmitasByOption ?? []} total={s.marmitasTotal ?? 0} title="Marmitas de hoje" /></div>

          {owner && <>
          <h2 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wide text-slate-500">Dinheiro de hoje</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Vendido" value={money(s.salesCents)} sub="Total dos pedidos" />
            <Stat label="Recebido" value={money(s.receivedCents)} tone="good" sub="Já entrou de fato" />
            <Stat label="A receber" value={money(s.receivableCents)} tone={s.receivableCents ? 'warn' : 'default'} sub="Pedidos ainda não pagos" />
            <Stat label="Gastos" value={money(s.purchasesCents + s.expensesCents)} sub="Compras + despesas" />
          </div>
          </>}

          {(data.stock.low > 0 || data.stock.out > 0) && (
            <Link to="/estoque?acabando=1" className="mt-4 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <PackageX className="h-5 w-5 shrink-0" />
              <span><strong>Estoque acabando:</strong> {data.stock.out > 0 && `${data.stock.out} item(ns) zerado(s)`}{data.stock.out > 0 && data.stock.low > 0 && ' e '}{data.stock.low > 0 && `${data.stock.low} quase no fim`}. Toque para ver a lista.</span>
            </Link>
          )}

          {owner && <div className="mt-4"><PayablesCard /></div>}
          {owner && <p className="mt-4 text-xs text-slate-500">Outros dias, semana e mês: veja em <Link className="underline" to="/relatorios">Relatórios</Link>.</p>}
        </>
      )}
    </div>
  );
}
