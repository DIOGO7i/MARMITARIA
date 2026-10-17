import { ReactNode, ReactElement, useEffect, useState, createContext, useContext, useCallback, useId, isValidElement, cloneElement, ButtonHTMLAttributes } from 'react';
import { Loader2, X, CheckCircle2, AlertTriangle, Inbox } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 disabled:bg-brand-500/50',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:opacity-50',
};

export function Button({ variant = 'primary', loading, children, className = '', ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button {...p} disabled={p.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children, className = '' }: { label: string; hint?: string; error?: string | null; children: ReactNode; className?: string }) {
  const auto = useId();
  const single = isValidElement(children) && typeof children.type === 'string' ? (children as ReactElement<any>) : null;
  const id = single?.props.id ?? auto;
  const helpId = `${id}-help`;
  if (!single) {
    // Conteúdo composto (ex.: grupo de botões): rótulo como legenda de grupo
    return (
      <div role="group" aria-label={label} className={`block ${className}`}>
        <span className="label">{label}</span>
        {children}
        {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
        {error && <span className="mt-1 block text-xs font-medium text-red-600">{error}</span>}
      </div>
    );
  }
  return (
    <div className={`block ${className}`}>
      <label htmlFor={id} className="label">{label}</label>
      {cloneElement(single, { id, 'aria-describedby': hint || error ? helpId : undefined, 'aria-invalid': error ? true : undefined })}
      {hint && !error && <span id={helpId} className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span id={helpId} className="mt-1 block text-xs font-medium text-red-600">{error}</span>}
    </div>
  );
}

export function Badge({ children, cls }: { children: ReactNode; cls: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-h-[95vh] sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-bold">{title}</h2>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-slate-100" aria-label="Fechar"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:rounded-b-2xl sm:pb-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, message, confirmLabel = 'Confirmar', danger, onConfirm, onClose, children }:
  { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<unknown> | unknown; onClose: () => void; children?: ReactNode }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose} disabled={busy}>Voltar</Button>
      <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>{confirmLabel}</Button>
    </>}>
      <p className="text-sm text-slate-700">{message}</p>
      {children}
    </Modal>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <Inbox className="h-10 w-10 text-slate-300" aria-hidden />
      <p className="font-semibold text-slate-700">{title}</p>
      {hint && <p className="max-w-sm text-sm text-slate-500">{hint}</p>}
      {action}
    </div>
  );
}

export function Stat({ label, value, sub, tone = 'default', icon }: { label: string; value: ReactNode; sub?: string; tone?: 'default' | 'good' | 'warn' | 'bad'; icon?: ReactNode }) {
  const t = { default: 'text-slate-900', good: 'text-green-700', warn: 'text-amber-700', bad: 'text-red-700' }[tone];
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500"><span>{label}</span>{icon}</div>
      <div className={`mt-1 text-2xl font-bold ${t}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-sm">
      <span className="text-slate-500">{total} registros</span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</Button>
        <span>Página {page} de {pages}</span>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Próxima</Button>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="no-print mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="font-display text-3xl leading-tight text-brand-800 sm:text-4xl">{title}</h1>{subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}</div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{message}</div>;
}

// ---- Toasts ----
interface Toast { id: number; kind: 'ok' | 'err'; text: string }
const ToastCtx = createContext<{ ok: (t: string) => void; err: (t: string) => void }>({ ok: () => {}, err: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, kind, text }].slice(-3)); // no máximo 3 avisos na tela
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={{ ok: (t) => push('ok', t), err: (t) => push('err', t) }}>
      {children}
      <div className="no-print pointer-events-none fixed right-4 top-4 z-60 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm shadow-lg ${t.kind === 'ok' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
            {t.kind === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Executa uma ação assíncrona uma única vez por vez (evita cliques repetidos) e mostra o erro real. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (busy) return undefined;
    setBusy(true); setError(null);
    try { return await fn(); }
    catch (e: any) { setError(e?.message ?? 'Erro inesperado.'); return undefined; }
    finally { setBusy(false); }
  }, [busy]);
  return { busy, error, setError, run };
}
