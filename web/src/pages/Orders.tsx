import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import DistanceBadge from '../components/DistanceBadge';
import { AlertTriangle, Eye, Pencil, Plus, Printer, Search } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useApp, nowLocal } from '../lib/context';
import { dateBR, dateTimeBR, itemLabel, money, nextStatus, ORDER_STATUS, PAY_STATUS, SOURCE, parseCents, centsToInput, statusFlow, statusInfo } from '../lib/format';
import { Badge, Button, Confirm, Empty, ErrorBox, Field, Modal, PageHeader, Pagination, useAction, useToast } from '../components/ui';
import OrderForm from './OrderForm';
import WhatsAppButton from '../components/WhatsAppButton';
import { flushBluetooth, flushBluetoothQuiet, getDeviceMode } from '../lib/btprint';

export function StatusBadge({ s, late, type }: { s: string; late?: boolean; type?: string }) {
  const st = statusInfo(s, type);
  return (<span className="inline-flex flex-wrap gap-1">
    <Badge cls={st.cls}><span aria-hidden>{st.icon}</span>{st.label}</Badge>
    {late && <Badge cls="bg-red-100 text-red-800"><AlertTriangle className="h-3 w-3" />Atrasado</Badge>}
  </span>);
}

export default function Orders() {
  const { today, settings } = useApp();
  const toast = useToast();
  const [filters, setFilters] = useState({ date: today, source: '', status: '', size: '', customer: '', payment: '', paymentStatus: '', q: '', late: false });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; rows: any[]; pageSize: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  // atalhos vindos do perfil do cliente: ?novo=1&tel=... abre o Novo pedido já com o telefone; ?pedido=ID abre os detalhes
  const [form, setForm] = useState<{ order?: any; phone?: string } | null>(() => (params.get('novo') ? { phone: params.get('tel') ?? undefined } : null));
  const [detail, setDetail] = useState<number | null>(() => (params.get('pedido') ? Number(params.get('pedido')) : null));
  // o botão "+" da barra do celular abre o Novo pedido mesmo quando já se está em Pedidos
  useEffect(() => {
    if (params.get('novo')) setForm((f) => f ?? { phone: params.get('tel') ?? undefined });
    if (params.get('novo') || params.get('pedido')) setParams({}, { replace: true });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const [lateCount, setLateCount] = useState(0);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [d, late] = await Promise.all([
        api('GET', '/orders' + qs({ ...filters, page, pageSize: 20 })),
        api('GET', '/orders' + qs({ late: true, pageSize: 1 })),
      ]);
      setData(d); setLateCount(late.total);
    } catch (e: any) { setError(e.message); }
  }, [filters, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const setFilter = (k: string, v: any) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); };

  const advance = async (o: any) => {
    const next = nextStatus(o.status, o.deliveryType);
    if (!next || busyId) return;
    setBusyId(o.id);
    try { await api('POST', `/orders/${o.id}/status`, { status: next }); toast.ok(`Pedido #${o.number}: ${statusInfo(next, o.deliveryType).label}.`); await load(); }
    catch (e: any) { toast.err(e.message); }
    finally { setBusyId(null); }
  };

  return (
    <div>
      <PageHeader title="Pedidos de marmitas" subtitle="Presencial e WhatsApp"
        actions={<Button onClick={() => setForm({})} className="px-5! py-2.5! text-base"><Plus className="h-5 w-5" />Novo pedido</Button>} />

      <div className="no-print mb-3 flex flex-wrap gap-2">
        <Button variant={filters.date === today && !filters.late && !filters.status ? 'primary' : 'secondary'} onClick={() => { setPage(1); setFilters((f) => ({ ...f, date: today, late: false, status: '' })); }}>Hoje</Button>
        <Button variant={filters.status === 'pendente' ? 'primary' : 'secondary'} onClick={() => { setPage(1); setFilters((f) => ({ ...f, date: '', late: false, status: 'pendente' })); }}>Pendentes</Button>
        <Button variant={filters.late ? 'danger' : 'secondary'} onClick={() => { setPage(1); setFilters((f) => ({ ...f, date: '', status: '', late: !f.late })); }}>
          <AlertTriangle className="h-4 w-4" />Atrasados ({lateCount})
        </Button>
        <Button variant="ghost" onClick={() => { setPage(1); setFilters({ date: '', source: '', status: '', size: '', customer: '', payment: '', paymentStatus: '', q: '', late: false }); }}>Ver todos</Button>
      </div>

      <div className="card no-print mb-3 grid gap-2 p-3 sm:grid-cols-3 lg:grid-cols-7">
        <label className="relative sm:col-span-3 lg:col-span-2">
          <span className="sr-only">Buscar</span>
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Nº, nome ou telefone" value={filters.q} onChange={(e) => setFilter('q', e.target.value)} />
        </label>
        <input aria-label="Data" type="date" className="input" value={filters.date} onChange={(e) => setFilter('date', e.target.value)} />
        <select aria-label="Origem" className="input" value={filters.source} onChange={(e) => setFilter('source', e.target.value)}><option value="">Toda origem</option><option value="presencial">Presencial</option><option value="whatsapp">WhatsApp</option></select>
        <select aria-label="Status" className="input" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}><option value="">Todo status</option>{Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select aria-label="Tamanho" className="input" value={filters.size} onChange={(e) => setFilter('size', e.target.value)}><option value="">Todo tamanho</option>{settings!.sizes.map((s) => <option key={s.name}>{s.name}</option>)}</select>
        <select aria-label="Forma de pagamento" className="input" value={filters.payment} onChange={(e) => setFilter('payment', e.target.value)}><option value="">Todo pagamento</option>{settings!.paymentMethods.map((m) => <option key={m}>{m}</option>)}</select>
      </div>

      <ErrorBox message={error} />
      <div className="card overflow-hidden">
        {!data ? <p className="p-4 text-slate-500">Carregando…</p> : data.rows.length === 0 ? (
          <Empty title="Nenhum pedido encontrado" hint={filters.date === today ? 'Ainda não há pedidos hoje. Clique em “Novo pedido” para registrar o primeiro.' : 'Ajuste os filtros ou clique em “Ver todos”.'}
            action={<Button onClick={() => setForm({})}><Plus className="h-4 w-4" />Novo pedido</Button>} />
        ) : (<>
          {/* tabela no computador */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full">
              <thead className="bg-slate-50"><tr>
                <th className="th">Nº</th><th className="th">Cliente</th><th className="th">Origem</th><th className="th">Marmitas</th><th className="th">Pedido</th><th className="th">Previsto</th><th className="th text-right">Total</th><th className="th">Status</th><th className="th text-right">Ações</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((o) => (
                  <tr key={o.id} className={o.late ? 'bg-red-50/50' : ''}>
                    <td className="td font-bold">#{o.number}</td>
                    <td className="td">{o.customerName || <span className="text-slate-400">—</span>}<div className="text-xs text-slate-500">{o.customerPhone}</div></td>
                    <td className="td">{SOURCE[o.source]}<div className="text-xs text-slate-500">{o.deliveryType === 'entrega' ? 'Entrega' : 'Retirada'}</div></td>
                    <td className="td">{o.items.map(itemLabel).join(', ')}</td>
                    <td className="td whitespace-nowrap">{dateBR(o.orderDate)} {o.orderTime}</td>
                    <td className="td whitespace-nowrap">{o.expectedAt ? dateTimeBR(o.expectedAt) : '—'}</td>
                    <td className="td text-right font-semibold">{money(o.totalCents)}<div><Badge cls={PAY_STATUS[o.paymentStatus].cls}>{PAY_STATUS[o.paymentStatus].label}</Badge></div></td>
                    <td className="td"><StatusBadge s={o.status} late={o.late} type={o.deliveryType} /></td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        {nextStatus(o.status, o.deliveryType) && <Button variant="secondary" className="px-2! py-1! text-xs" loading={busyId === o.id} onClick={() => advance(o)}>→ {statusInfo(nextStatus(o.status, o.deliveryType)!, o.deliveryType).label}</Button>}
                        <WhatsAppButton order={o} compact />
                        <Button variant="ghost" className="p-1.5!" onClick={() => setDetail(o.id)} aria-label="Detalhes"><Eye className="h-4 w-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* cartões no celular */}
          <ul className="divide-y divide-slate-100 md:hidden">
            {data.rows.map((o) => (
              <li key={o.id} className={`p-3 ${o.late ? 'bg-red-50/50' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <button className="text-left" onClick={() => setDetail(o.id)}>
                    <div className="font-bold">#{o.number} · {o.customerName || 'Sem nome'}</div>
                    <div className="text-xs text-slate-500">{SOURCE[o.source]} · {o.orderTime} · {o.items.map(itemLabel).join(', ')}</div>
                  </button>
                  <div className="text-right font-semibold">{money(o.totalCents)}</div>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <StatusBadge s={o.status} late={o.late} type={o.deliveryType} />
                  <div className="flex items-center gap-1"><WhatsAppButton order={o} compact />{nextStatus(o.status, o.deliveryType) && <Button variant="secondary" className="px-2! py-1! text-xs" loading={busyId === o.id} onClick={() => advance(o)}>→ {statusInfo(nextStatus(o.status, o.deliveryType)!, o.deliveryType).label}</Button>}</div>
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>)}
      </div>

      {form && <OrderForm order={form.order} initialPhone={form.phone} onClose={() => setForm(null)} onSaved={(o) => { setForm(null); load(); if (form.order) setDetail(o.id); }} />}
      {detail && <OrderDetail id={detail} onClose={() => setDetail(null)} onChanged={load} onEdit={(o) => { setDetail(null); setForm({ order: o }); }} />}
    </div>
  );
}

function OrderDetail({ id, onClose, onChanged, onEdit }: { id: number; onClose: () => void; onChanged: () => void; onEdit: (o: any) => void }) {
  const { settings, user } = useApp();
  const toast = useToast();
  const [o, setO] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [pay, setPay] = useState(false);
  const [deliver, setDeliver] = useState(false);
  const act = useAction();

  const load = useCallback(() => api('GET', `/orders/${id}`).then(setO).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  const changeStatus = (status: string, extra: any = {}) => act.run(async () => {
    const r = await api('POST', `/orders/${id}/status`, { status, ...extra });
    setO(r); onChanged(); toast.ok(`Status alterado para “${statusInfo(status, o.deliveryType).label}”.`);
    flushBluetoothQuiet(settings);
  });

  const bt = getDeviceMode() === 'bluetooth';
  if (!o) return <Modal title="Pedido" onClose={onClose}>{err ? <ErrorBox message={err} /> : 'Carregando…'}</Modal>;
  const open = o.totalCents - o.paidCents;

  return (
    <Modal wide title={`Pedido #${o.number}`} onClose={onClose} footer={<>
      {o.status !== 'cancelado' && <Button variant="danger" className="mr-auto" onClick={() => setCancel(true)}>Cancelar pedido</Button>}
      {o.status === 'cancelado' && <Button variant="secondary" className="mr-auto" loading={act.busy} onClick={() => changeStatus('pendente')}>Reabrir pedido</Button>}
      {bt ? (
        <Button variant="secondary" onClick={() => act.run(async () => { await api('POST', `/orders/${o.id}/print`); const n = await flushBluetooth(settings!); toast.ok(n ? `Pedido #${o.number} mandado para a impressora Bluetooth.` : 'Nada para imprimir.'); })}><Printer className="h-4 w-4" />Imprimir comanda</Button>
      ) : <>
        <Button variant="secondary" onClick={() => act.run(async () => { await api('POST', `/orders/${o.id}/print`); toast.ok(`Pedido #${o.number} vai sair na impressora da cozinha.`); })}><Printer className="h-4 w-4" />Imprimir na cozinha</Button>
        <Button variant="ghost" onClick={() => window.open(`/pedidos/${o.id}/imprimir`, '_blank')}>Imprimir aqui</Button>
      </>}
      {o.status !== 'cancelado' && <Button variant="secondary" onClick={() => onEdit(o)}><Pencil className="h-4 w-4" />Editar</Button>}
    </>}>
      <ErrorBox message={act.error} />
      <div className="mb-3 flex flex-wrap items-center gap-2"><StatusBadge s={o.status} late={o.late} type={o.deliveryType} /><Badge cls={PAY_STATUS[o.paymentStatus].cls}>{PAY_STATUS[o.paymentStatus].label}</Badge>
        <span className="ml-auto"><WhatsAppButton key={o.status} order={o} /></span></div>

      {o.status !== 'cancelado' && (
        <div className="mb-4">
          <div className="label">Alterar status</div>
          <div className="flex flex-wrap gap-1.5">
            {statusFlow(o.deliveryType).map((s) => (
              <button key={s} disabled={act.busy || o.status === s} onClick={() => s === 'entregue' ? setDeliver(true) : changeStatus(s)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${o.status === s ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300 hover:bg-slate-50'} disabled:cursor-default`}>
                {statusInfo(s, o.deliveryType).icon} {statusInfo(s, o.deliveryType).label}
              </button>
            ))}
          </div>
        </div>
      )}
      {o.status === 'cancelado' && <div className="mb-3 rounded-lg bg-slate-100 p-3 text-sm">Cancelado em {dateTimeBR(o.cancelledAt)}. Motivo: <strong>{o.cancelReason}</strong>. Os valores foram preservados para consulta e não contam como venda.</div>}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-slate-500">Data/hora do pedido</dt><dd>{dateBR(o.orderDate)} {o.orderTime}</dd></div>
        <div><dt className="text-xs text-slate-500">Origem</dt><dd>{SOURCE[o.source]}</dd></div>
        <div><dt className="text-xs text-slate-500">Cliente</dt><dd>{o.customerId ? <Link className="font-semibold text-brand-700 underline" to={`/clientes/${o.customerId}`}>{o.customerName || 'Ver cliente'}</Link> : (o.customerName || '—')} {o.customerPhone && <span className="text-slate-500">· {o.customerPhone}</span>}</dd></div>
        <div><dt className="text-xs text-slate-500">Tipo</dt><dd>{o.deliveryType === 'entrega' ? `Entrega${o.neighborhood ? ` — ${o.neighborhood}` : ''}` : 'Retirada no local'}</dd></div>
        <div><dt className="text-xs text-slate-500">Previsto</dt><dd>{dateTimeBR(o.expectedAt)}</dd></div>
        <div><dt className="text-xs text-slate-500">{o.deliveryType === 'retirada' ? 'Retirado em' : 'Entregue em'}</dt><dd>{dateTimeBR(o.deliveredAt)}</dd></div>
        {o.address && <div className="col-span-2 sm:col-span-3"><dt className="text-xs text-slate-500">Endereço</dt><dd>{o.address}</dd>
          {o.deliveryType === 'entrega' && <dd className="mt-1 empty:hidden"><DistanceBadge compact street={String(o.address).split(' — ')[0]} neighborhood={o.neighborhood} /></dd>}</div>}
      </dl>

      <table className="mt-4 w-full text-sm">
        <thead className="bg-slate-50"><tr><th className="th">Marmita</th><th className="th">Obs.</th><th className="th text-right">Qtd.</th><th className="th text-right">Unit.</th><th className="th text-right">Total</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{o.items.map((i: any) => (
          <tr key={i.id}><td className="td">{i.size}{i.option && <div className="text-xs font-semibold text-brand-700">{i.option}</div>}</td><td className="td">{i.notes || '—'}</td><td className="td text-right">{i.qty}</td><td className="td text-right">{money(i.unitPriceCents)}</td><td className="td text-right">{money(i.totalCents)}</td></tr>
        ))}</tbody>
      </table>
      {o.notes && <p className="mt-2 text-sm"><strong>Observações:</strong> {o.notes}</p>}

      <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
        <span>Subtotal</span><strong>{money(o.subtotalCents)}</strong>
        <span>Frete cobrado</span><strong>{money(o.deliveryFeeCents)}</strong>
        <span>Desconto</span><strong>{money(o.discountCents)}</strong>
        <span>Total</span><strong className="text-brand-700">{money(o.totalCents)}</strong>
        {user?.role === 'owner' && <><span>Custo do entregador</span><strong>{money(o.deliveryCostCents)}</strong></>}
        <span>Recebido</span><strong className="text-green-700">{money(o.paidCents)}</strong>
        <span>A receber</span><strong className={open > 0 ? 'text-amber-700' : ''}>{money(o.status === 'cancelado' ? 0 : open)}</strong>
        <span>Forma</span><strong>{o.paymentMethod || '—'}</strong>
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between"><h3 className="text-sm font-bold">Recebimentos</h3>
          {o.status !== 'cancelado' && open > 0 && <Button variant="secondary" className="py-1! text-xs" onClick={() => setPay(true)}>Registrar recebimento</Button>}</div>
        {o.payments.length === 0 ? <p className="text-sm text-slate-500">Nenhum recebimento registrado.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">{o.payments.map((p: any) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
              <span>{dateBR(p.paidDate)} · {p.method || '—'} {p.notes && <span className="text-xs text-slate-500">({p.notes})</span>}</span>
              <span className="flex items-center gap-2"><strong className={p.amountCents < 0 ? 'text-red-700' : ''}>{money(p.amountCents)}</strong>
                {p.amountCents > 0 && o.status !== 'cancelado' && user?.role === 'owner' && !o.payments.some((x: any) => x.notes === `Estorno do recebimento #${p.id}`) &&
                  <button className="text-xs text-red-600 underline" onClick={() => act.run(async () => { setO(await api('POST', `/orders/${o.id}/payments/${p.id}/reverse`)); onChanged(); toast.ok('Recebimento estornado.'); })}>estornar</button>}
              </span>
            </li>
          ))}</ul>
        )}
      </div>

      {o.history?.length > 0 && (
        <details className="mt-4 text-sm"><summary className="cursor-pointer font-bold">Histórico</summary>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-600">{o.history.map((h: any, i: number) => <li key={i}>{new Date(h.at).toLocaleString('pt-BR')} — {h.action}{h.detail ? ` ${h.detail}` : ''}</li>)}</ul>
        </details>
      )}

      {cancel && (
        <Confirm danger title={`Cancelar pedido #${o.number}?`} confirmLabel="Cancelar pedido" onClose={() => setCancel(false)}
          message="O pedido continuará no histórico, mas deixará de contar como venda. Recebimentos já registrados serão estornados."
          onConfirm={async () => {
            if (!reason.trim()) { toast.err('Informe o motivo do cancelamento.'); return; }
            try { const r = await api('POST', `/orders/${id}/status`, { status: 'cancelado', reason }); setO(r); onChanged(); setCancel(false); toast.ok(`Pedido #${o.number} cancelado.`); flushBluetoothQuiet(settings); }
            catch (e: any) { toast.err(e.message); }
          }}>
          <Field label="Motivo do cancelamento" className="mt-3"><input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </Confirm>
      )}
      {pay && <PaymentModal max={open} methods={settings!.paymentMethods} defaultMethod={o.paymentMethod} onClose={() => setPay(false)}
        onSubmit={async (b) => { setO(await api('POST', `/orders/${o.id}/payments`, b)); onChanged(); setPay(false); toast.ok('Recebimento registrado.'); }} />}
      {deliver && <DeliverModal pickup={o.deliveryType === 'retirada'} canEdit={user?.role === 'owner'} tz={settings!.timezone} onClose={() => setDeliver(false)}
        onSubmit={async (deliveredAt) => { await changeStatus('entregue', deliveredAt ? { deliveredAt } : {}); setDeliver(false); }} />}
    </Modal>
  );
}

export function PaymentModal({ max, methods, defaultMethod, onClose, onSubmit, title = 'Registrar recebimento', fixed }:
  { max: number; methods: string[]; defaultMethod?: string | null; onClose: () => void; onSubmit: (b: any) => Promise<void>; title?: string; fixed?: boolean }) {
  const { today } = useApp();
  const [amount, setAmount] = useState(centsToInput(max));
  const [method, setMethod] = useState(defaultMethod ?? '');
  const [date, setDate] = useState(today);
  const act = useAction();
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Voltar</Button>
      <Button loading={act.busy} onClick={() => act.run(async () => {
        const c = parseCents(amount);
        if (c === null || c <= 0) throw new Error('Valor inválido.');
        if (c > max) throw new Error(`O valor máximo em aberto é ${money(max)}.`);
        if (!method) throw new Error('Escolha a forma. É ela que diz se o dinheiro entra na gaveta do Caixa do dia.');
        await onSubmit({ amountCents: c, method: method || null, paidDate: date });
      })}>Confirmar</Button>
    </>}>
      <ErrorBox message={act.error} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Valor (R$)" hint={`Em aberto: ${money(max)}`}><input className="input" inputMode="decimal" disabled={fixed} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Forma"><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}><option value="">Escolha…</option>{methods.map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Data"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function DeliverModal({ pickup, canEdit, tz, onClose, onSubmit }: { pickup?: boolean; canEdit: boolean; tz: string; onClose: () => void; onSubmit: (at: string | null) => Promise<void> }) {
  const n = nowLocal(tz);
  const [manual, setManual] = useState(false);
  const [at, setAt] = useState(`${n.date}T${n.time}`);
  const act = useAction();
  return (
    <Modal title={pickup ? 'Marcar como retirado' : 'Marcar como entregue'} onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Voltar</Button>
      <Button loading={act.busy} onClick={() => act.run(() => onSubmit(manual ? at : null))}>{pickup ? 'Confirmar retirada' : 'Confirmar entrega'}</Button>
    </>}>
      <ErrorBox message={act.error} />
      <p className="text-sm">O horário {pickup ? 'em que o cliente buscou' : 'real da entrega'} será registrado automaticamente agora ({n.time}).</p>
      {canEdit && (
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />Informar outro horário (correção manual)</label>
      )}
      {manual && <input type="datetime-local" className="input mt-2" value={at} onChange={(e) => setAt(e.target.value)} />}
    </Modal>
  );
}
