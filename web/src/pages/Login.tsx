import { FormEvent, useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { Button, ErrorBox, Field, useAction } from '../components/ui';
import ThemeToggle from '../components/ThemeToggle';

type Mode = 'login' | 'setup' | 'forgot';

/** Login simples: e-mail e senha. Fica conectado por 30 dias neste aparelho. */
export default function Login() {
  const { login } = useApp();
  const [status, setStatus] = useState<{ needsSetup: boolean; emailReset: boolean } | null>(null);
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [emailSent, setEmailSent] = useState<string | null>(null);
  const { busy, error, run, setError } = useAction();

  useEffect(() => {
    api<{ needsSetup: boolean; emailReset: boolean }>('GET', '/auth/status')
      .then((r) => { setStatus(r); setMode(r.needsSetup ? 'setup' : 'login'); })
      .catch((e) => { setStatus({ needsSetup: false, emailReset: false }); setError(e.message); });
  }, [setError]);

  const go = (m: Mode) => { setError(null); setEmailSent(null); setMode(m); };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (mode === 'setup') {
        const r = await api('POST', '/auth/setup', { name, email, password });
        await login(r.token, r.user);
      } else if (mode === 'login') {
        const r = await api('POST', '/auth/login', { email, password });
        await login(r.token, r.user);
      } else {
        const r = await api('POST', '/auth/forgot', { email });
        setEmailSent(r.message);
      }
    });
  };

  const title = { login: 'Entre para continuar.', setup: 'Primeiro acesso: crie o seu usuário.', forgot: 'Esqueci minha senha' }[mode];

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-logo p-4">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <div className="card w-full max-w-sm space-y-4 p-6">
        <div className="text-center">
          <img src="/logo-192.png" alt="Gisa Agustoni Gastronomia — O sabor de casa, todos os dias." className="mx-auto h-28 w-28 rounded-full shadow-md" />
          <h1 className="mt-3 font-display text-3xl text-brand-800">Gisa Agustoni Gastronomia</h1>
          <p className="mt-1 text-sm text-slate-500">{title}</p></div>

        {mode === 'forgot' && !status?.emailReset ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">Fale com quem instalou o sistema. Essa pessoa cria uma senha nova para você em um minuto, sem perder nenhum dado.</p>
            <button type="button" className="w-full text-center text-sm font-medium text-slate-600 underline" onClick={() => go('login')}>Voltar para o login</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <ErrorBox message={error} />
            {mode === 'setup' && <Field label="Seu nome"><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>}
            <Field label="E-mail"><input className="input" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>

            {mode !== 'forgot' && (
              <div>
                <label htmlFor="senha" className="label">Senha</label>
                <div className="relative">
                  <input id="senha" className="input pr-11" type={show ? 'text' : 'password'} autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                    minLength={mode === 'setup' ? 6 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} required />
                  <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Esconder senha' : 'Mostrar senha'} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500">
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {mode === 'setup' && <span className="mt-1 block text-xs text-slate-500">Mínimo de 6 caracteres.</span>}
              </div>
            )}

            {mode === 'forgot' && (emailSent
              ? <div role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{emailSent}</div>
              : <p className="text-sm text-slate-600">Vamos mandar um link para o seu e-mail. Ele vale por 1 hora.</p>)}

            {!(mode === 'forgot' && emailSent) && (
              <Button type="submit" loading={busy} className="w-full py-2.5! text-base" disabled={!status}>
                {mode === 'setup' ? 'Criar e entrar' : mode === 'login' ? 'Entrar' : 'Enviar link'}
              </Button>
            )}
            {mode === 'login' && <p className="text-center text-xs text-slate-500">Você fica conectado neste aparelho por 30 dias.</p>}
            {mode === 'login' && <button type="button" className="w-full text-center text-sm font-medium text-brand-700 underline" onClick={() => go('forgot')}>Esqueci a senha</button>}
            {mode === 'forgot' && <button type="button" className="w-full text-center text-sm font-medium text-slate-600 underline" onClick={() => go('login')}>Voltar para o login</button>}
          </form>
        )}
      </div>
    </div>
  );
}
