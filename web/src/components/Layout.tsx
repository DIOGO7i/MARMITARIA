import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, UtensilsCrossed, Boxes, ShoppingCart, PackageMinus, Receipt, BarChart3, Settings as Cog, LogOut, Menu, X, ChefHat, Wallet, Users, ClipboardList, Lock, UserCog, Printer, Plus, MoreHorizontal } from 'lucide-react';
import AlertsBar from './AlertsBar';
import { useApp } from '../lib/context';
import ThemeToggle from './ThemeToggle';
import Brand from './Brand';

type NavItem = { to: string; label: string; icon: any; end?: boolean; module?: 'fichas' | 'estoqueCompleto' };
// Dia a dia: o que a equipe usa na correria. Todo mundo vê.
const daily: NavItem[] = [
  { to: '/', label: 'Hoje', icon: LayoutDashboard, end: true },
  { to: '/pedidos', label: 'Pedidos', icon: UtensilsCrossed },
  { to: '/cardapio', label: 'Cardápio do dia', icon: ClipboardList },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/estoque', label: 'Estoque', icon: Boxes },
  { to: '/cozinha', label: 'Cozinha (impressora)', icon: Printer },
];
// Gestão: dinheiro, lucros e gastos. Só a responsável vê (o servidor também bloqueia).
const management: NavItem[] = [
  { to: '/caixa', label: 'Caixa do dia', icon: Wallet },
  { to: '/compras', label: 'Compras', icon: ShoppingCart },
  { to: '/despesas', label: 'Despesas e contas', icon: Receipt },
  { to: '/relatorios', label: 'Relatórios', icon: BarChart3 },
  // módulos extras (só aparecem se quem instalou ligar em MODULOS_EXTRAS)
  { to: '/fichas', label: 'Fichas técnicas', icon: ChefHat, module: 'fichas' },
  { to: '/saidas', label: 'Saídas de estoque', icon: PackageMinus, module: 'estoqueCompleto' },
  { to: '/configuracoes', label: 'Configurações e equipe', icon: Cog },
];

export default function Layout() {
  const { user, settings, logout } = useApp();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const loc = useLocation();
  const sair = () => { navigate('/', { replace: true }); logout(); };

  const owner = user?.role === 'owner';
  const item = (n: NavItem) => (
    <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}
      className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-3 text-base font-medium lg:py-2.5 lg:text-sm ${isActive ? 'bg-brand-500 text-white' : 'text-slate-700 hover:bg-slate-100'}`}>
      <n.icon className="h-5 w-5" aria-hidden />{n.label}
    </NavLink>
  );
  // aba da barra de baixo do celular
  const tab = (to: string, label: string, Icon: any, end?: boolean) => {
    const active = end ? loc.pathname === to : loc.pathname.startsWith(to);
    return (
      <NavLink to={to} end={end} aria-current={active ? 'page' : undefined}
        className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${active ? 'text-brand-700' : 'text-slate-500'}`}>
        <span className={`flex h-7 w-12 items-center justify-center rounded-full ${active ? 'bg-brand-100' : ''}`}><Icon className="h-5 w-5" aria-hidden /></span>{label}
      </NavLink>
    );
  };
  const visible = (n: NavItem) => !n.module || settings?.modules?.[n.module];
  const links = (
    <nav className="flex flex-col gap-1 p-3" aria-label="Menu principal">
      {owner && <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Dia a dia</div>}
      {daily.filter(visible).map(item)}
      {owner ? (<>
        <div className="mt-4 flex items-center gap-1.5 px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-brand-700"><Lock className="h-3 w-3" aria-hidden />Gestão · só você</div>
        {management.filter(visible).map(item)}
      </>) : (
        <div className="mt-4 border-t border-slate-200 pt-3">{item({ to: '/conta', label: 'Minha conta', icon: UserCog })}</div>
      )}
    </nav>
  );
  const foot = (
    <div className="border-t border-slate-200 p-3 text-sm">
      <div className="mb-2 truncate text-slate-600">{user?.name}<span className="ml-1 text-xs text-slate-400">· {owner ? 'responsável' : 'funcionário'}</span></div>
      <ThemeToggle withLabel />
      <button onClick={sair} className="flex w-full items-center gap-2 rounded-lg px-3 py-3 font-medium lg:py-2 text-slate-700 hover:bg-slate-100"><LogOut className="h-4 w-4" />Sair</button>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="no-print hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="bg-logo px-4 py-4"><Brand /></div>
        <div className="flex-1 overflow-y-auto">{links}</div>
        {foot}
      </aside>

      {/* Celular: topo só com a marca; navegação na barra de baixo (o polegar alcança) */}
      <header className="no-print sticky top-0 z-40 flex items-center justify-between gap-2 bg-logo px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] shadow-sm lg:hidden">
        <Brand size="sm" />
        <div className="flex shrink-0 items-center text-logo-ink"><ThemeToggle /></div>
      </header>

      <nav aria-label="Atalhos" className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto grid h-16 max-w-xl grid-cols-5 items-stretch">
          {tab('/', 'Hoje', LayoutDashboard, true)}
          {tab('/pedidos', 'Pedidos', UtensilsCrossed)}
          <div className="flex items-start justify-center">
            <button type="button" onClick={() => navigate('/pedidos?novo=1')} aria-label="Novo pedido"
              className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-white shadow-lg ring-4 ring-white active:scale-95">
              <Plus className="h-7 w-7" aria-hidden />
            </button>
          </div>
          {tab('/cardapio', 'Cardápio', ClipboardList)}
          <button type="button" onClick={() => setOpen(true)} aria-label="Abrir menu" aria-expanded={open}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${open ? 'text-brand-700' : 'text-slate-500'}`}>
            <MoreHorizontal className="h-6 w-6" aria-hidden />Mais
          </button>
        </div>
      </nav>

      {open && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <span className="font-bold">Menu</span>
              <button onClick={() => setOpen(false)} aria-label="Fechar menu" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto">{links}</div>
            {foot}
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 p-4 pb-[calc(var(--nav-h)+1rem)] sm:p-6 sm:pb-[calc(var(--nav-h)+1.5rem)]"><AlertsBar /><Outlet /></main>
    </div>
  );
}
