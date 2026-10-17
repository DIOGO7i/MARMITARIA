import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, UserCheck, UserX } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { MIN_PASSWORD } from '../lib/format';
import { Badge, Button, ErrorBox, Field, Modal, useAction, useToast } from './ui';

interface U { id: number; name: string; email: string; role: 'owner' | 'staff'; active: boolean }

/** Equipe: a responsável cadastra quem trabalha com ela. Funcionário só vê o dia a dia (pedidos, cardápio, clientes, estoque). */
export default function TeamSettings() {
  const { user } = useApp();
  const toast = useToast();
  const [list, setList] = useState<U[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pwFor, setPwFor] = useState<U | null>(null);
  const load = useCallback(() => api<U[]>('GET', '/users').then((l) => { setList(l); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (u: U) => {
    try { await api('PUT', `/users/${u.id}`, { active: !u.active }); toast.ok(u.active ? `Acesso de ${u.name} desativado. Ele(a) saiu de todos os aparelhos.` : `Acesso de ${u.name} reativado.`); load(); }
    catch (e: any) { toast.err(e.message); }
  };

  return (
    <section className="card p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">Equipe</h2>
        <Button variant="secondary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Adicionar funcionário</Button>
      </div>
      <p className="mb-3 text-sm text-slate-500">
        O <strong>funcionário</strong> usa o dia a dia: pedidos (vê o total e marca como pago), cardápio, clientes e estoque.
        Ele <strong>não vê</strong> caixa, compras, despesas, relatórios, custos nem configurações. Cada pessoa entra com o próprio e-mail e senha.
      </p>
      <ErrorBox message={error} />
      {!list ? <p className="text-sm text-slate-500">Carregando…</p> : (
        <ul className="divide-y divide-slate-100">
          {list.map((u) => (
            <li key={u.id} className={`flex flex-wrap items-center gap-2 py-2.5 ${u.active ? '' : 'opacity-60'}`}>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{u.name}{u.id === user?.id && <span className="ml-1 text-xs font-normal text-slate-500">(você)</span>}</div>
                <div className="truncate text-xs text-slate-500">{u.email}</div>
              </div>
              <Badge cls={u.role === 'owner' ? 'bg-brand-100 text-brand-800' : 'bg-slate-100 text-slate-700'}>{u.role === 'owner' ? 'Responsável' : 'Funcionário'}</Badge>
              {!u.active && <Badge cls="bg-red-100 text-red-800">Desativado</Badge>}
              {u.id !== user?.id && <>
                <Button variant="ghost" className="px-2! py-1! text-xs" onClick={() => setPwFor(u)}><KeyRound className="h-3.5 w-3.5" />Nova senha</Button>
                <Button variant="ghost" className="px-2! py-1! text-xs" onClick={() => toggle(u)}>{u.active ? <><UserX className="h-3.5 w-3.5" />Desativar</> : <><UserCheck className="h-3.5 w-3.5" />Reativar</>}</Button>
              </>}
            </li>
          ))}
        </ul>
      )}
      {adding && <AddUser onClose={() => setAdding(false)} onSaved={(u) => { setAdding(false); toast.ok(`${u.name} já pode entrar com o e-mail ${u.email}.`); load(); }} />}
      {pwFor && <NewPassword u={pwFor} onClose={() => setPwFor(null)} onSaved={() => { toast.ok(`Senha de ${pwFor.name} trocada. Ele(a) precisa entrar de novo.`); setPwFor(null); }} />}
    </section>
  );
}

function AddUser({ onClose, onSaved }: { onClose: () => void; onSaved: (u: U) => void }) {
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'staff' as 'staff' | 'owner' });
  const act = useAction();
  const save = () => act.run(async () => {
    if (f.password.length < MIN_PASSWORD) throw new Error(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
    onSaved(await api<U>('POST', '/users', f));
  });
  return (
    <Modal title="Adicionar à equipe" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={act.busy} onClick={save}>Adicionar</Button></>}>
      <ErrorBox message={act.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome" className="sm:col-span-2"><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="E-mail (para entrar)"><input className="input" type="email" autoCapitalize="none" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Senha" hint={`Mínimo de ${MIN_PASSWORD} caracteres. Passe para a pessoa; ela pode trocar depois.`}><input className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Field label="O que pode ver" className="sm:col-span-2">
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Permissão">
            {([['staff', 'Funcionário', 'Só o dia a dia, sem financeiro'], ['owner', 'Responsável', 'Tudo, inclusive o financeiro']] as const).map(([k, t, d]) => (
              <label key={k} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${f.role === k ? 'border-brand-500 bg-brand-50' : 'border-slate-300'}`}>
                <input type="radio" name="papel" className="mt-0.5" checked={f.role === k} onChange={() => setF({ ...f, role: k })} />
                <span><strong className="block">{t}</strong><span className="text-xs text-slate-500">{d}</span></span>
              </label>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function NewPassword({ u, onClose, onSaved }: { u: U; onClose: () => void; onSaved: () => void }) {
  const [p, setP] = useState('');
  const act = useAction();
  return (
    <Modal title={`Nova senha para ${u.name}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
      <Button loading={act.busy} onClick={() => act.run(async () => { await api('PUT', `/users/${u.id}`, { password: p }); onSaved(); })}>Trocar senha</Button></>}>
      <ErrorBox message={act.error} />
      <Field label="Nova senha" hint="A pessoa sai dos aparelhos e entra com a senha nova."><input className="input" autoFocus value={p} onChange={(e) => setP(e.target.value)} /></Field>
    </Modal>
  );
}
