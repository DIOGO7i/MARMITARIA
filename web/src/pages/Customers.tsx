import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { api, qs } from '../lib/api';
import { dateBR, money } from '../lib/format';
import { checkPhone, maskPhone } from '../lib/phone';
import { Button, Empty, ErrorBox, Field, Modal, PageHeader, Pagination, useAction, useToast } from '../components/ui';
import AddressFields, { emptyAddress } from '../components/AddressFields';

export default function Customers() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(() => api('GET', '/customers' + qs({ q, page })).then((r) => { setData(r); setError(null); }).catch((e) => setError(e.message)), [q, page]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  return (
    <div>
      <PageHeader title="Clientes" subtitle="Cadastro, endereços e histórico de pedidos" actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Novo cliente</Button>} />
      <div className="card mb-3 p-3">
        <label className="relative block"><span className="sr-only">Buscar cliente</span><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Buscar por nome ou telefone" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} /></label>
      </div>
      <ErrorBox message={error} />
      <div className="card overflow-hidden">
        {!data ? <p className="p-4 text-slate-500">Carregando…</p> : data.rows.length === 0 ? (
          <Empty title={q ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado ainda'}
            hint={q ? 'Confira o nome ou telefone.' : 'Os clientes também são cadastrados automaticamente ao registrar um pedido com telefone novo.'}
            action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Cadastrar cliente</Button>} />
        ) : (<>
          <div className="overflow-x-auto"><table className="w-full min-w-[640px]">
            <thead className="bg-slate-50"><tr><th className="th">Cliente</th><th className="th">Telefone</th><th className="th text-right">Endereços</th><th className="th text-right">Pedidos</th><th className="th">Último pedido</th>{data.rows[0]?.totalSpentCents !== undefined && <th className="th text-right">Total gasto</th>}</tr></thead>
            <tbody className="divide-y divide-slate-100">{data.rows.map((c: any) => (
              <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/clientes/${c.id}`)}>
                <td className="td font-semibold"><Link to={`/clientes/${c.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{c.name}</Link></td>
                <td className="td whitespace-nowrap">{c.phoneFormatted}</td>
                <td className="td text-right">{c.addressCount}</td>
                <td className="td text-right">{c.orders}</td>
                <td className="td">{c.lastOrderAt ? dateBR(c.lastOrderAt) : '—'}</td>
                {c.totalSpentCents !== undefined && <td className="td text-right">{money(c.totalSpentCents)}</td>}
              </tr>
            ))}</tbody>
          </table></div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>)}
      </div>
      {creating && <NewCustomerModal onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); navigate(`/clientes/${c.id}`); }} />}
    </div>
  );
}

export function NewCustomerModal({ onClose, onSaved }: { onClose: () => void; onSaved: (c: any) => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [notes, setNotes] = useState('');
  const [withAddr, setWithAddr] = useState(true);
  const [addr, setAddr] = useState(emptyAddress());
  const [existing, setExisting] = useState<number | null>(null);
  const act = useAction();
  const chk = checkPhone(phone);
  const save = () => act.run(async () => {
    setExisting(null);
    if (!name.trim()) throw new Error('Informe o nome do cliente.');
    if (!chk.digits) throw new Error(chk.error ?? 'Informe o telefone com DDD.');
    if (withAddr && (addr.street.trim() || addr.neighborhood.trim()) && !addr.street.trim()) throw new Error('Informe a rua e o número do endereço.');
    const addresses = withAddr && addr.street.trim() ? [{ ...addr, label: addr.label.trim() || 'Casa', neighborhood: addr.neighborhood.trim() || null }] : [];
    try {
      const c = await api('POST', '/customers', { name, phone: chk.digits, notes, addresses });
      toast.ok('Cliente cadastrado.');
      onSaved(c);
    } catch (e: any) {
      if (e.status === 409) { const r = await api('GET', `/customers/by-phone/${chk.digits}`); setExisting(r.customer?.id ?? null); }
      throw e;
    }
  });
  return (
    <Modal wide title="Novo cliente" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={act.busy} onClick={save}>Cadastrar</Button></>}>
      <ErrorBox message={act.error} />
      {existing && <p className="mb-3 text-sm"><button className="font-semibold text-brand-700 underline" onClick={() => navigate(`/clientes/${existing}`)}>Abrir o cadastro existente</button></p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome"><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Telefone (com DDD)" error={chk.error}><input className="input" inputMode="tel" placeholder="(11) 98888-7777" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} /></Field>
        <Field label="Observações (opcional)" className="sm:col-span-2"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Prefere sem cebola, interfone quebrado…" /></Field>
      </div>
      <label className="mb-2 mt-4 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={withAddr} onChange={(e) => setWithAddr(e.target.checked)} />Cadastrar um endereço agora</label>
      {withAddr && <AddressFields a={addr} onChange={setAddr} />}
    </Modal>
  );
}
