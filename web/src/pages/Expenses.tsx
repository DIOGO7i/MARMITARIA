import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useApp } from '../lib/context';
import { monthRange } from '../lib/dates';
import { centsToInput, dateBR, money, parseCents } from '../lib/format';
import { Badge, Button, Confirm, Empty, ErrorBox, Field, Modal, PageHeader, useAction, useToast } from '../components/ui';
import { PaymentModal } from './Orders';

export default function Expenses() {
  const { today, settings } = useApp();
  const toast = useToast();
  const m = monthRange(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  const [f, setF] = useState({ from: m.from, to: m.to, category: '', status: '', q: '', voided: false });
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<any | null>(null);
  const [voidE, setVoidE] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(() => api('GET', '/expenses' + qs(f)).then((r) => { setRows(r); setError(null); }).catch((e) => setError(e.message)), [f]);
  useEffect(() => { load(); }, [load]);
  const active = rows?.filter((r) => !r.voided) ?? [];

  const [payE, setPayE] = useState<any | null>(null);
  // sempre pergunta a forma (já vem marcada a da despesa): é ela que diz se o dinheiro sai da gaveta do Caixa do dia
  const pay = (e: any) => { if (!busy) setPayE(e); };

  return (
    <div>
      <PageHeader title="Despesas" subtitle="Custos que não são compra de mercadoria (as compras ficam em “Compras e entradas”)."
        actions={<Button onClick={() => setForm({})}><Plus className="h-4 w-4" />Nova despesa</Button>} />
      <div className="card mb-3 grid gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6">
        <input aria-label="De" type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <input aria-label="Até" type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <select aria-label="Categoria" className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Toda categoria</option>{settings!.expenseCategories.map((c) => <option key={c}>{c}</option>)}</select>
        <select aria-label="Status" className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Pagas e pendentes</option><option value="pago">Pagas</option><option value="pendente">Pendentes</option></select>
        <input aria-label="Buscar" className="input" placeholder="Buscar descrição" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.voided} onChange={(e) => setF({ ...f, voided: e.target.checked })} />Mostrar anuladas</label>
      </div>
      {active.length > 0 && <div className="mb-3 flex flex-wrap gap-4 text-sm">
        <span>Total: <strong>{money(active.reduce((a, r) => a + r.amountCents, 0))}</strong></span>
        <span>Pago: <strong className="text-green-700">{money(active.reduce((a, r) => a + r.paidCents, 0))}</strong></span>
        <span>Pendente: <strong className="text-amber-700">{money(active.reduce((a, r) => a + r.amountCents - r.paidCents, 0))}</strong></span>
      </div>}
      <ErrorBox message={error} />
      <div className="card overflow-hidden">
        {!rows ? <p className="p-4 text-slate-500">Carregando…</p> : rows.length === 0 ? (
          <Empty title="Nenhuma despesa no período" hint="Registre contas como água, luz, gás, aluguel e pagamentos a entregadores." action={<Button onClick={() => setForm({})}><Plus className="h-4 w-4" />Nova despesa</Button>} />
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px]">
            <thead className="bg-slate-50"><tr><th className="th">Data</th><th className="th">Descrição</th><th className="th">Categoria</th><th className="th text-right">Valor</th><th className="th">Status</th><th className="th">Vencimento</th><th className="th text-right">Ações</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map((e) => {
              const overdue = !e.voided && e.status !== 'pago' && e.dueDate && e.dueDate < today;
              return (
                <tr key={e.id} className={e.voided ? 'opacity-50' : ''}>
                  <td className="td">{dateBR(e.expenseDate)}</td>
                  <td className="td">{e.description}{e.voided && <div className="text-xs">Anulada: {e.voidReason}</div>}{e.notes && <div className="text-xs text-slate-500">{e.notes}</div>}</td>
                  <td className="td">{e.category}</td>
                  <td className="td text-right font-semibold">{money(e.amountCents)}</td>
                  <td className="td">{e.voided ? <Badge cls="bg-slate-200 text-slate-700">✖ Anulada</Badge> : e.status === 'pago' ? <Badge cls="bg-green-100 text-green-800">✔ Paga{e.paymentMethod ? ` · ${e.paymentMethod}` : ''}</Badge> : <Badge cls={overdue ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}>{overdue ? '⚠ Vencida' : '⏳ Pendente'}</Badge>}</td>
                  <td className="td">{dateBR(e.dueDate)}</td>
                  <td className="td"><div className="flex justify-end gap-1">
                    {!e.voided && e.status !== 'pago' && <Button variant="secondary" className="px-2! py-1! text-xs" loading={busy === e.id} onClick={() => pay(e)}>Marcar paga</Button>}
                    {!e.voided && <Button variant="ghost" className="p-1.5!" aria-label="Editar" onClick={() => setForm(e)}><Pencil className="h-4 w-4" /></Button>}
                    {!e.voided && <Button variant="ghost" className="px-2! py-1! text-xs text-red-700" onClick={() => { setReason(''); setVoidE(e); }}>Anular</Button>}
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>
      {payE && <PaymentModal title={`Pagar “${payE.description}”`} max={payE.amountCents - (payE.paidCents ?? 0)} fixed methods={settings!.paymentMethods} defaultMethod={payE.paymentMethod} onClose={() => setPayE(null)}
        onSubmit={async (b) => { await api('POST', `/expenses/${payE.id}/pay`, { method: b.method, paidDate: b.paidDate }); setPayE(null); toast.ok('Despesa marcada como paga.'); load(); }} />}
      {form && <ExpenseForm expense={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
      {voidE && <Confirm danger title="Anular despesa?" confirmLabel="Anular" onClose={() => setVoidE(null)}
        message={`“${voidE.description}” (${money(voidE.amountCents)}) deixará de contar nos totais, mas continuará no histórico.${voidE.status === 'pago' ? ' O pagamento será estornado.' : ''}`}
        onConfirm={async () => {
          if (!reason.trim()) { toast.err('Informe o motivo.'); return; }
          try { await api('POST', `/expenses/${voidE.id}/void`, { reason }); toast.ok('Despesa anulada.'); setVoidE(null); load(); } catch (e: any) { toast.err(e.message); }
        }}>
        <Field label="Motivo" className="mt-3"><input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Confirm>}
    </div>
  );
}

function ExpenseForm({ expense, onClose, onSaved }: { expense: any | null; onClose: () => void; onSaved: () => void }) {
  const { today, settings } = useApp();
  const toast = useToast();
  const [f, setF] = useState({
    description: expense?.description ?? '', category: expense?.category ?? settings!.expenseCategories[0], date: expense?.expenseDate ?? today,
    amount: expense ? centsToInput(expense.amountCents) : '', method: expense?.paymentMethod ?? '', status: expense?.status === 'pago' ? 'pago' : 'pendente',
    due: expense?.dueDate ?? '', notes: expense?.notes ?? '', confirmStock: false,
  });
  const act = useAction();
  const looksLikeGoods = /mercadoria|compra|insumo|estoque|arroz|feij|carne|frango|verdura|embalag/i.test(f.description);
  const save = () => act.run(async () => {
    const a = parseCents(f.amount);
    if (!f.description.trim()) throw new Error('Informe a descrição.');
    if (a === null || a <= 0) throw new Error('Informe um valor maior que zero.');
    if (!expense && f.status === 'pago' && !f.method) throw new Error('Escolha a forma de pagamento. É ela que diz se o dinheiro entra na gaveta do Caixa do dia.');
    if (!expense && looksLikeGoods && !f.confirmStock) throw new Error('Parece uma compra de mercadoria. Compras de estoque devem ser lançadas em “Compras e entradas”. Se for outro gasto, marque a confirmação abaixo.');
    const body = { description: f.description, category: f.category, expenseDate: f.date, amountCents: a, paymentMethod: f.method || null, status: f.status, dueDate: f.due || null, notes: f.notes };
    if (expense) await api('PUT', `/expenses/${expense.id}`, body); else await api('POST', '/expenses', body);
    toast.ok(expense ? 'Despesa atualizada.' : 'Despesa registrada.');
    onSaved();
  });
  return (
    <Modal title={expense ? 'Editar despesa' : 'Nova despesa'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={act.busy} onClick={save}>Salvar</Button></>}>
      <ErrorBox message={act.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Descrição" className="sm:col-span-2"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Categoria"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{settings!.expenseCategories.map((c) => <option key={c}>{c}</option>)}{!settings!.expenseCategories.includes(f.category) && <option>{f.category}</option>}</select></Field>
        <Field label="Data da despesa"><input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Valor (R$)" hint={expense?.status === 'pago' ? 'Despesa paga: valor bloqueado.' : undefined}><input className="input" inputMode="decimal" disabled={expense?.status === 'pago'} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Forma de pagamento"><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="">Não informada</option>{settings!.paymentMethods.map((x) => <option key={x}>{x}</option>)}</select></Field>
        {!expense && <Field label="Status"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="pendente">Pendente</option><option value="pago">Pago</option></select></Field>}
        <Field label="Vencimento (opcional)"><input type="date" className="input" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
        <Field label="Observações" className="sm:col-span-2"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {!expense && looksLikeGoods && <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900 sm:col-span-2"><input type="checkbox" className="mt-1" checked={f.confirmStock} onChange={(e) => setF({ ...f, confirmStock: e.target.checked })} />Confirmo que esta despesa NÃO é uma compra já registrada em “Compras e entradas”.</label>}
      </div>
    </Modal>
  );
}
