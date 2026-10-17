import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './lib/context';
import Layout from './components/Layout';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import OrderPrint from './pages/OrderPrint';
import Stock from './pages/Stock';
import Purchases from './pages/Purchases';
import StockOut from './pages/StockOut';
import Expenses from './pages/Expenses';
import Reports from './pages/Reports';
import SettingsPage from './pages/Settings';
import Recipes from './pages/Recipes';
import Cash from './pages/Cash';
import Customers from './pages/Customers';
import CustomerProfile from './pages/CustomerProfile';
import MenuPage from './pages/Menu';
import Account from './pages/Account';
import Kitchen from './pages/Kitchen';
import PhoneFrame from './components/PhoneFrame';
import { getScreenMode, inFrame } from './lib/screen';

export default function App() {
  const { user, settings } = useApp();
  // "Tela: Celular" num computador: mostra o sistema numa moldura de celular
  if (!inFrame && getScreenMode() === 'celular' && window.innerWidth >= 700) return <PhoneFrame />;
  const mods = settings?.modules;
  const owner = user?.role === 'owner';
  if (!user) return window.location.pathname === '/redefinir-senha' ? <ResetPassword /> : <Login />;
  return (
    <Routes>
      <Route path="/pedidos/:id/imprimir" element={<OrderPrint />} />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="pedidos" element={<Orders />} />
        <Route path="estoque" element={<Stock />} />
        <Route path="cardapio" element={<MenuPage />} />
        <Route path="clientes" element={<Customers />} />
        <Route path="clientes/:id" element={<CustomerProfile />} />
        <Route path="conta" element={<Account />} />
        <Route path="cozinha" element={<Kitchen />} />
        {/* Gestão (financeiro): só a responsável. Para o funcionário essas telas nem existem e voltam para Hoje. */}
        {owner && (<>
          {mods?.fichas && <Route path="fichas" element={<Recipes />} />}
          <Route path="caixa" element={<Cash />} />
          <Route path="compras" element={<Purchases />} />
          {mods?.estoqueCompleto && <Route path="saidas" element={<StockOut />} />}
          <Route path="despesas" element={<Expenses />} />
          <Route path="relatorios" element={<Reports />} />
          <Route path="configuracoes" element={<SettingsPage />} />
        </>)}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
