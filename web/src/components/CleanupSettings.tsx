// Apagar os pedidos e clientes de teste antes de começar a usar de verdade.
// Antes de apagar, baixa uma cópia de segurança (se der errado, dá para voltar).
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api, getToken } from '../lib/api';
import { useApp } from '../lib/context';
import { dateBR } from '../lib/format';
import { Button, ErrorBox, Field, useToast } from './ui';

async function downloadBackup() {
  const r = await fetch('/api/backup', { headers: { authorization: `Bearer ${getToken()}` } });
  if (!r.ok) throw new Error('Não consegui baixar a cópia de segurança. Nada foi apagado.');
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a'); a.href = url; a.download = `marmitaria-antes-de-limpar.db`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function CleanupSettings() {
  const { today } = useApp();
  const toast = useToast();
  const [pedidos, setPedidos] = useState(true);
  const [clientes, setClientes] = useState(true);
  const [ate, setAte] = useState(today);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = confirm.trim().toUpperCase() === 'APAGAR' && (pedidos || clientes);

  const run = async () => {
    setBusy(true); setError(null);
    try {
      await downloadBackup();
      const r = await api<{ orders: number; customers: number }>('POST', '/limpar-testes', { confirm: 'APAGAR', pedidos, clientes, ate });
      setConfirm('');
      toast.ok(`Pronto: ${pedidos ? `${r.orders} pedido(s)` : ''}${pedidos && clientes ? ' e ' : ''}${clientes ? `${r.customers} cliente(s)` : ''} apagado(s). A cópia de antes foi baixada.`);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <section className="card border-red-200 p-4">
      <h2 className="mb-1 flex items-center gap-2 font-bold text-red-700"><Trash2 className="h-5 w-5" />Apagar dados de teste</h2>
      <p className="mb-3 text-sm text-slate-600">
        Para começar do zero depois dos testes. Apaga os pedidos (com os recebimentos e as comandas) e/ou os clientes.
        <strong> Cardápio, preços, configurações, equipe, compras, despesas e estoque ficam.</strong> A numeração dos pedidos volta para o #1.
        Antes de apagar, o sistema baixa uma cópia de segurança para o celular.
      </p>
      <div className="space-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={pedidos} onChange={(e) => setPedidos(e.target.checked)} />Pedidos até o dia</label>
        {pedidos && <Field label="Apagar pedidos até" className="ml-6"><input type="date" aria-label="Apagar pedidos até" className="input w-auto!" value={ate} max={today} onChange={(e) => e.target.value && setAte(e.target.value)} /></Field>}
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={clientes} onChange={(e) => setClientes(e.target.checked)} />Todos os clientes cadastrados</label>
      </div>
      <Field label='Para confirmar, digite APAGAR' className="mt-3">
        <input aria-label="Confirmação" className="input" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="APAGAR" />
      </Field>
      <ErrorBox message={error} />
      <Button className="mt-3 bg-red-600! hover:bg-red-700!" disabled={!ok} loading={busy} onClick={run}>
        <Trash2 className="h-4 w-4" />Baixar cópia e apagar{pedidos ? ` pedidos até ${dateBR(ate)}` : ''}{pedidos && clientes ? ' e' : ''}{clientes ? ' clientes' : ''}
      </Button>
    </section>
  );
}
