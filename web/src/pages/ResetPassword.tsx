import { FormEvent, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { Button, ErrorBox, Field, useAction } from '../components/ui';

/** Página aberta pelo link enviado por e-mail: /redefinir-senha?token=... */
export default function ResetPassword() {
  const { login } = useApp();
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [p1, setP1] = useState(''); const [p2, setP2] = useState('');
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (p1 !== p2) throw new Error('As duas senhas não são iguais.');
      const r = await api('POST', '/auth/reset', { token, newPassword: p1 });
      window.history.replaceState(null, '', '/');
      await login(r.token, r.user);
    });
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-logo p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div className="text-center"><img src="/logo-192.png" alt="Gisa Agustoni Gastronomia" className="mx-auto h-24 w-24 rounded-full shadow-md" /><h1 className="mt-3 font-display text-3xl text-brand-800">Criar nova senha</h1></div>
        {!token ? <ErrorBox message="Link incompleto. Abra novamente o link do e-mail." /> : <>
          <ErrorBox message={error} />
          <Field label="Nova senha" hint="Mínimo de 6 caracteres."><input className="input" type="password" autoComplete="new-password" minLength={6} value={p1} onChange={(e) => setP1(e.target.value)} required /></Field>
          <Field label="Repita a nova senha"><input className="input" type="password" autoComplete="new-password" minLength={6} value={p2} onChange={(e) => setP2(e.target.value)} required /></Field>
          <Button type="submit" loading={busy} className="w-full">Salvar nova senha</Button>
        </>}
        <a href="/" className="block text-center text-sm text-slate-600 underline">Voltar para o login</a>
      </form>
    </div>
  );
}
