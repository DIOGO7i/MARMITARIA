import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

export type ThemeMode = 'claro' | 'escuro' | 'auto';
const KEY = 'marmitaria.tema';
const read = (): ThemeMode => { try { const v = localStorage.getItem(KEY); return v === 'claro' || v === 'escuro' ? v : 'auto'; } catch { return 'auto'; } };
const systemDark = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;

const Ctx = createContext<{ mode: ThemeMode; dark: boolean; setMode: (m: ThemeMode) => void; cycle: () => void }>(null as any);
export const useTheme = () => useContext(Ctx);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(read);
  const [sys, setSys] = useState<boolean>(systemDark);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const h = (e: MediaQueryListEvent) => setSys(e.matches);
    mq?.addEventListener?.('change', h);
    return () => mq?.removeEventListener?.('change', h);
  }, []);
  const dark = mode === 'escuro' || (mode === 'auto' && sys);
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  const setMode = (m: ThemeMode) => { setModeState(m); try { localStorage.setItem(KEY, m); } catch { /* navegador sem armazenamento */ } };
  const cycle = () => setMode(dark ? 'claro' : 'escuro');
  return <Ctx.Provider value={{ mode, dark, setMode, cycle }}>{children}</Ctx.Provider>;
}

export const THEME_LABEL: Record<ThemeMode, string> = { claro: 'Claro', escuro: 'Escuro', auto: 'Automático (igual ao aparelho)' };
