import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { printTicket, ticketHtml } from '../lib/ticket';
import { Button, ErrorBox } from '../components/ui';

/** "Imprimir aqui": a mesma comanda da cozinha, no tamanho do rolo (80/58 mm), na impressora deste aparelho. */
export default function OrderPrint() {
  const { id } = useParams();
  const { settings } = useApp();
  const [o, setO] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api('GET', `/orders/${id}`).then(setO).catch((e) => setErr(e.message)); }, [id]);
  const html = useMemo(() => (o ? ticketHtml(o, 'novo', settings!) : ''), [o, settings]);
  const paper = settings?.kitchenPrint?.paper ?? '80';
  useEffect(() => { if (html) printTicket(html, paper); }, [html, paper]);
  if (err) return <div className="p-4"><ErrorBox message={err} /></div>;
  if (!o) return <p className="p-4">Carregando…</p>;
  return (
    <div className="mx-auto max-w-md p-4">
      <div className="mb-3 flex gap-2"><Button onClick={() => printTicket(html, paper)}>Imprimir de novo</Button><Button variant="secondary" onClick={() => window.close()}>Fechar</Button></div>
      <iframe title={`Comanda do pedido #${o.number}`} srcDoc={html} className="h-[80vh] w-full rounded-lg border border-slate-200 bg-white" />
    </div>
  );
}
