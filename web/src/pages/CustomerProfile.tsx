import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Home, Pencil, Plus, Trash2, UtensilsCrossed } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { dateBR, money, statusInfo } from '../lib/format';
import { checkPhone, maskPhone } from '../lib/phone';
import { Badge, Button, Confirm, Empty, ErrorBox, Field, Modal, PageHeader, useAction, useToast } from '../components/ui';
import AddressFields, { AddressDraft, emptyAddress } from '../components/AddressFields';
import DistanceBadge from '../components/DistanceBadge';

export default function CustomerProfile() {
  const { id } = useParams();
  const { user, settings } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [c, setC] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [addrForm, setAddrForm] = useState<{ id?: number; draft: AddressDraft } | null>(null);
  const [delAddr, setDelAddr] = useState<any>(null);
  const [delCustomer, setDelCustomer] = useState(false);

  const load = useCallback(() => api('GET', `/customers/${id}`).then((r) => { setC(r); setError(null); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div><Link to="/clientes" className="mb-3 inline-flex items-center gap-1 text-sm underline"><ArrowLeft className="h-4 w-4" />Clientes</Link><ErrorBox message={error} /></div>;
  if (!c) return <p className="text-slate-500">Carregando…</p>;

  return (
    <div className="max-w-5xl">
      <Link to="/clientes" className="no-print mb-2 inline-flex items-center gap-1 text-sm text-slate-600 hover:underline"><ArrowLeft className="h-4 w-4" />Clientes</Link>
      <PageHeader title={c.name} subtitle={`${c.phoneFormatted} · cliente desde ${dateBR(c.createdAt)}`} actions={<>
        <Button onClick={() => navigate(`/pedidos?novo=1&tel=${c.phone}`)}><UtensilsCrossed className="h-4 w-4" />Novo pedido</Button>
        <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Editar</Button>
      </>} />
      {c.notes && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><strong>Observações:</strong> {c.notes}</p>}

      <div className={`mb-4 grid gap-3 ${c.totalSpentCents !== undefined ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div className="card p-3"><div className="text-xs text-slate-500">Pedidos</div><div className="text-xl font-bold">{c.orders}</div></div>
        {c.totalSpentCents !== undefined && <div className="card p-3"><div className="text-xs text-slate-500">Total gasto</div><div className="text-xl font-bold">{money(c.totalSpentCents)}</div></div>}
        <div className="card p-3"><div className="text-xs text-slate-500">Último pedido</div><div className="text-xl font-bold">{c.lastOrderAt ? dateBR(c.lastOrderAt) : '—'}</div></div>
      </div>

      <section className="card mb-4 p-4">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">Endereços</h2>
          <Button variant="secondary" onClick={() => setAddrForm({ draft: emptyAddress(c.addresses.length ? 'Trabalho' : 'Casa') })}><Plus className="h-4 w-4" />Adicionar endereço</Button></div>
        {c.addresses.length === 0 ? <p className="text-sm text-slate-500">Nenhum endereço salvo.</p> : (
          <ul className="grid gap-2 sm:grid-cols-2">{c.addresses.map((a: any) => {
            return (
              <li key={a.id} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                <Home className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <div className="min-w-0 flex-1"><div className="font-semibold">{a.label}</div><div>{a.text}</div>
                  {a.neighborhood && <div className="text-xs text-slate-500">{a.neighborhood}</div>}
                  <div className="mt-1 empty:hidden"><DistanceBadge compact street={a.street} neighborhood={a.neighborhood} /></div></div>
                <Button variant="ghost" className="p-1.5!" aria-label={`Editar endereço ${a.label}`} onClick={() => setAddrForm({ id: a.id, draft: { label: a.label, street: a.street, complement: a.complement ?? '', neighborhood: a.neighborhood ?? '', reference: a.reference ?? '' } })}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" className="p-1.5! text-red-600" aria-label={`Excluir endereço ${a.label}`} onClick={() => setDelAddr(a)}><Trash2 className="h-4 w-4" /></Button>
              </li>
            );
          })}</ul>
        )}
      </section>

      <section className="card overflow-hidden">
        <h2 className="p-4 pb-2 font-bold">Histórico de pedidos</h2>
        {c.orderHistory.length === 0 ? <Empty title="Nenhum pedido ainda" hint="Os pedidos registrados com o telefone deste cliente aparecem aqui." /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50"><tr><th className="th">Nº</th><th className="th">Data</th><th className="th">Marmitas</th><th className="th">Endereço usado</th><th className="th text-right">Total</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {c.orderHistory.map((o: any) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <td className="td font-bold"><Link className="hover:underline" to={`/pedidos?pedido=${o.id}`}>#{o.number}</Link></td>
                  <td className="td whitespace-nowrap">{dateBR(o.orderDate)} {o.orderTime}</td>
                  <td className="td">{o.itemsText}</td>
                  <td className="td">{o.deliveryType === 'retirada' ? <span className="text-slate-500">Retirada no local</span> : <>{o.address}{o.neighborhood && <div className="text-xs text-slate-500">{o.neighborhood}</div>}</>}</td>
                  <td className="td text-right">{money(o.totalCents)}</td>
                  <td className="td"><Badge cls={statusInfo(o.status, o.deliveryType).cls}>{statusInfo(o.status, o.deliveryType).label}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      {user?.role === 'owner' && (
        <div className="mt-6 text-right"><Button variant="ghost" className="text-red-700" onClick={() => setDelCustomer(true)}><Trash2 className="h-4 w-4" />Excluir cadastro do cliente</Button></div>
      )}

      {editing && <EditCustomer c={c} onClose={() => setEditing(false)} onSaved={(r) => { setC(r); setEditing(false); toast.ok('Cadastro atualizado.'); }} />}
      {addrForm && <AddressModal customerId={c.id} form={addrForm} onClose={() => setAddrForm(null)} onSaved={(r) => { setC(r); setAddrForm(null); toast.ok(addrForm.id ? 'Endereço atualizado.' : 'Endereço adicionado.'); }} />}
      {delAddr && <Confirm danger title={`Excluir o endereço “${delAddr.label}”?`} confirmLabel="Excluir endereço" onClose={() => setDelAddr(null)}
        message="Os pedidos antigos continuam mostrando o endereço que foi usado na época. Ele só deixa de aparecer como opção em novos pedidos."
        onConfirm={async () => { try { setC(await api('DELETE', `/customers/${c.id}/addresses/${delAddr.id}`)); setDelAddr(null); toast.ok('Endereço excluído.'); } catch (e: any) { toast.err(e.message); } }} />}
      {delCustomer && <Confirm danger title={`Excluir o cadastro de ${c.name}?`} confirmLabel="Excluir cadastro" onClose={() => setDelCustomer(false)}
        message="O nome, telefone e endereços salvos serão apagados do cadastro. Os pedidos antigos continuam no histórico financeiro (com os dados registrados na época), mas sem vínculo com o cadastro. Não dá para desfazer."
        onConfirm={async () => { try { await api('DELETE', `/customers/${c.id}`); toast.ok('Cadastro excluído.'); navigate('/clientes'); } catch (e: any) { toast.err(e.message); } }} />}
    </div>
  );
}

function EditCustomer({ c, onClose, onSaved }: { c: any; onClose: () => void; onSaved: (r: any) => void }) {
  const [name, setName] = useState(c.name); const [phone, setPhone] = useState(c.phoneFormatted); const [notes, setNotes] = useState(c.notes ?? '');
  const act = useAction();
  const chk = checkPhone(phone);
  return (
    <Modal title="Editar cliente" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
      <Button loading={act.busy} onClick={() => act.run(async () => {
        if (!name.trim()) throw new Error('Informe o nome do cliente.');
        if (!chk.digits) throw new Error(chk.error ?? 'Informe o telefone com DDD.');
        onSaved(await api('PUT', `/customers/${c.id}`, { name, phone: chk.digits, notes }));
      })}>Salvar</Button></>}>
      <ErrorBox message={act.error} />
      <div className="grid gap-3">
        <Field label="Nome"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Telefone (com DDD)" error={chk.error}><input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} /></Field>
        <Field label="Observações"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function AddressModal({ customerId, form, onClose, onSaved }: { customerId: number; form: { id?: number; draft: AddressDraft }; onClose: () => void; onSaved: (c: any) => void }) {
  const [a, setA] = useState(form.draft);
  const act = useAction();
  return (
    <Modal wide title={form.id ? 'Editar endereço' : 'Novo endereço'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
      <Button loading={act.busy} onClick={() => act.run(async () => {
        if (!a.label.trim()) throw new Error('Dê um nome ao endereço (ex.: Casa, Trabalho).');
        if (!a.street.trim()) throw new Error('Informe a rua e o número.');
        const body = { ...a, neighborhood: a.neighborhood.trim() || null };
        if (form.id) onSaved(await api('PUT', `/customers/${customerId}/addresses/${form.id}`, body));
        else onSaved((await api('POST', `/customers/${customerId}/addresses`, body)).customer);
      })}>Salvar endereço</Button></>}>
      <ErrorBox message={act.error} />
      <AddressFields a={a} onChange={setA} />
      {form.id && <p className="mt-3 text-xs text-slate-500">Alterar o endereço não muda pedidos antigos: eles guardam o endereço usado na época.</p>}
    </Modal>
  );
}
