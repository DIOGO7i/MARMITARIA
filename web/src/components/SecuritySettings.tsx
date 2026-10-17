import { useState } from 'react';
import { Lock } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { Button, ErrorBox, Field, useAction, useToast } from './ui';
import { MIN_PASSWORD } from '../lib/format';

export default function SecuritySettings() {
  const { user, login, logout } = useApp();
  const all = useAction();
  const toast = useToast();
  const [f, setF] = useState({ current: '', p1: '', p2: '' });
  const pw = useAction();
  const changePassword = () => pw.run(async () => {
    if (f.p1.length < MIN_PASSWORD) throw new Error(`A nova senha deve ter ao menos ${MIN_PASSWORD} caracteres.`);
    if (f.p1 !== f.p2) throw new Error('As duas senhas novas não são iguais.');
    const r = await api('POST', '/me/password', { currentPassword: f.current, newPassword: f.p1 });
    await login(r.token, r.user); // continua logado aqui; outras sessões são desconectadas
    setF({ current: '', p1: '', p2: '' });
    toast.ok('Senha alterada. Outros aparelhos conectados precisarão entrar de novo.');
  });

  return (
    <section className="card space-y-4 p-4">
      <h2 className="flex items-center gap-2 font-bold"><Lock className="h-4 w-4" />Segurança da sua conta</h2>
      <p className="-mt-2 text-sm text-slate-500">Usuário: {user?.email}. Esqueceu a senha? Quem instalou o sistema cria uma nova para você.</p>

      <div>
        <h3 className="mb-2 text-sm font-bold">Trocar senha</h3>
        <ErrorBox message={pw.error} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Senha atual"><input className="input" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
          <Field label="Nova senha" hint={`Mínimo de ${MIN_PASSWORD} caracteres.`}><input className="input" type="password" autoComplete="new-password" value={f.p1} onChange={(e) => setF({ ...f, p1: e.target.value })} /></Field>
          <Field label="Repita a nova senha"><input className="input" type="password" autoComplete="new-password" value={f.p2} onChange={(e) => setF({ ...f, p2: e.target.value })} /></Field>
        </div>
        <Button className="mt-3" loading={pw.busy} disabled={!f.current || !f.p1 || !f.p2} onClick={changePassword}>Trocar senha</Button>
      </div>

      <div className="border-t border-slate-200 pt-4">
        <h3 className="mb-1 text-sm font-bold">Sair de todos os aparelhos</h3>
        <p className="mb-2 text-sm text-slate-600">Use se perder o celular, trocar de computador ou se alguém que usava o sistema não trabalha mais com você. Todos os aparelhos, inclusive este, precisarão entrar de novo com a senha.</p>
        <ErrorBox message={all.error} />
        <Button variant="secondary" loading={all.busy} onClick={() => all.run(async () => { await api('POST', '/me/logout-all', {}); logout(); })}>Sair de todos os aparelhos</Button>
      </div>

    </section>
  );
}
