// Como o sistema se mostra neste aparelho: Automático (pelo tamanho da tela), Celular ou Computador.
// Fica guardado só neste aparelho/navegador, como o tema.
export type ScreenMode = 'auto' | 'celular' | 'computador';
const KEY = 'marmitaria.tela';
export const inFrame = (() => { try { return window.self !== window.top; } catch { return true; } })();
export function getScreenMode(): ScreenMode {
  try { const v = localStorage.getItem(KEY); return v === 'celular' || v === 'computador' ? v : 'auto'; } catch { return 'auto'; }
}
/** Troca o modo e recarrega (a largura da tela muda de verdade, então é mais seguro recomeçar o desenho). */
export function setScreenMode(m: ScreenMode) {
  try { localStorage.setItem(KEY, m); } catch { /* sem armazenamento */ }
  try { (inFrame ? window.top! : window).location.reload(); } catch { window.location.reload(); }
}
export const SCREEN_LABEL: Record<ScreenMode, string> = { auto: 'Automático', celular: 'Celular', computador: 'Computador' };
