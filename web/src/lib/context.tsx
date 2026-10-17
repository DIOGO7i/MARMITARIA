import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';

export interface Settings {
  establishment: { name: string; phone: string; address: string; city?: string; hours: string; reportHeader: string };
  timezone: string;
  sizes: { name: string; priceCents: number }[];
  expenseCategories: string[];
  productCategories: string[];
  units: string[];
  paymentMethods: string[];
  defaultMinStockMilli: number;
  stockDeductOn: 'desativado' | 'em_preparo' | 'pronto' | 'saiu_para_entrega' | 'entregue';
  minMarginPct: number;
  neighborhoods: { name: string; feeCents: number; costCents: number }[];
  deliveryTiers?: { upToMeters: number; feeCents: number; costCents: number }[];
  kitchenPrint?: { enabled: boolean; paper: '80' | '58'; copies: number; printEdits: boolean; printCancels: boolean; showPrices: boolean; small?: boolean; noAccents?: boolean };
  dueAlertDays: number;
  whatsappTemplates: Record<string, string>;
  menuOptions: { name: string; description: string; sizes: string[] }[];
  /** Módulos extras ligados por quem instalou (MODULOS_EXTRAS no .env) */
  modules: { fichas: boolean; estoqueCompleto: boolean };
}
export interface User { id: number; name: string; email: string; role: 'owner' | 'staff' }

interface AppState {
  user: User | null; settings: Settings | null; today: string;
  login: (token: string, user: User) => Promise<void>; logout: () => void; reloadSettings: () => Promise<void>;
}
const Ctx = createContext<AppState>(null as any);
export const useApp = () => useContext(Ctx);

function localToday(tz: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function nowLocal(tz: string) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  const h = g('hour') === '24' ? '00' : g('hour');
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${h}:${g('minute')}` };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => { setToken(null); setUser(null); setSettings(null); }, []);
  const reloadSettings = useCallback(async () => setSettings(await api<Settings>('GET', '/settings')), []);
  const login = useCallback(async (token: string, u: User) => {
    setToken(token);
    setSettings(await api<Settings>('GET', '/settings'));
    setUser(u);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    (async () => {
      if (getToken()) {
        try { const u = await api<User>('GET', '/me'); setSettings(await api<Settings>('GET', '/settings')); setUser(u); }
        catch { setToken(null); }
      }
      setReady(true);
    })();
  }, [logout]);

  if (!ready) return <div className="p-8 text-center text-slate-500">Carregando…</div>;
  const today = localToday(settings?.timezone ?? 'America/Sao_Paulo');
  return <Ctx.Provider value={{ user, settings, today, login, logout, reloadSettings }}>{children}</Ctx.Provider>;
}
