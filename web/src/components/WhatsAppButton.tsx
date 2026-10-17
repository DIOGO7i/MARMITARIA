import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { useApp } from '../lib/context';
import { fillTemplate, waLink, waPhone, WA_LABELS } from '../lib/whatsapp';
import { Button, Modal } from './ui';

/** Abre o WhatsApp do cliente com a mensagem pronta do status atual (ou de outro, escolhendo na lista). */
export default function WhatsAppButton({ order, compact }: { order: any; compact?: boolean }) {
  const { settings } = useApp();
  const [open, setOpen] = useState(false);
  const phone = waPhone(order.customerPhone);
  // retirada não tem "saiu para entrega"; na entrega, a mensagem de "pronto" (que fala em retirar) não faz sentido
  const hide = order.deliveryType === 'retirada' ? 'saiu_para_entrega' : 'pronto';
  const tpls = Object.fromEntries(Object.entries(settings!.whatsappTemplates ?? {}).filter(([k]) => k !== hide));
  const [key, setKey] = useState<string>(tpls[order.status] ? order.status : Object.keys(tpls)[0]);
  const [text, setText] = useState('');
  const start = () => { const k = tpls[order.status] ? order.status : Object.keys(tpls)[0]; setKey(k); setText(fillTemplate(tpls[k] ?? '', order, settings!)); setOpen(true); };

  if (!phone) {
    if (compact) return null;
    return <span className="text-xs text-slate-500">{order.customerPhone ? 'Telefone sem DDD: não dá para abrir o WhatsApp.' : 'Sem telefone para WhatsApp.'}</span>;
  }
  return (
    <>
      {compact
        ? <button type="button" onClick={start} className="rounded-sm p-1.5 text-green-700 hover:bg-green-50" aria-label="Mandar mensagem no WhatsApp" title="Mandar mensagem no WhatsApp"><MessageCircle className="h-4 w-4" /></button>
        : <Button variant="secondary" onClick={start} className="border-green-600! text-green-700!"><MessageCircle className="h-4 w-4" />Avisar no WhatsApp</Button>}
      {open && (
        <Modal title={`WhatsApp — pedido #${order.number}`} onClose={() => setOpen(false)} footer={<>
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
          <a href={waLink(phone, text)} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}
            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-green-700"><MessageCircle className="h-4 w-4" />Abrir no WhatsApp</a>
        </>}>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {Object.keys(tpls).map((k) => (
              <button key={k} type="button" onClick={() => { setKey(k); setText(fillTemplate(tpls[k], order, settings!)); }} aria-pressed={key === k}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${key === k ? 'bg-green-600 text-white' : 'border border-slate-300'}`}>{k === 'pronto' ? 'Pronto para retirar' : WA_LABELS[k] ?? k}</button>
            ))}
          </div>
          <label className="label" htmlFor="wa-text">Mensagem (pode editar antes de enviar)</label>
          <textarea id="wa-text" className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          <p className="mt-2 text-xs text-slate-500">Para: +{phone}. O WhatsApp abre com a mensagem pronta e você só aperta enviar.</p>
        </Modal>
      )}
    </>
  );
}
