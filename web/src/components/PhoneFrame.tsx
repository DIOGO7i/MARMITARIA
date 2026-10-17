import { Monitor, Smartphone } from 'lucide-react';
import { setScreenMode } from '../lib/screen';

/** "Tela: Celular" num computador: o sistema aparece dentro de uma moldura com o tamanho de um celular. */
export default function PhoneFrame() {
  const src = window.location.pathname + window.location.search;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-200 p-6 lg:flex-row lg:gap-12">
      <div className="max-w-xs text-center lg:text-left">
        <Smartphone className="mx-auto mb-3 h-8 w-8 text-brand-700 lg:mx-0" aria-hidden />
        <h1 className="font-display text-3xl text-slate-900">Modo celular</h1>
        <p className="mt-2 text-sm text-slate-600">O sistema está do jeito que aparece no celular. Tudo funciona aqui dentro normalmente.</p>
        <button type="button" onClick={() => setScreenMode('auto')} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600">
          <Monitor className="h-4 w-4" />Voltar para a tela de computador
        </button>
      </div>
      <div className="rounded-[46px] bg-slate-900 p-3 shadow-2xl">
        <iframe title="Sistema no tamanho de celular" src={src} className="block rounded-[34px] bg-white" style={{ width: 390, height: 'min(844px, calc(100vh - 72px))' }} />
      </div>
    </div>
  );
}
