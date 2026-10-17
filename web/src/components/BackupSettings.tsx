import { useState } from 'react';
import { Download, ShieldCheck } from 'lucide-react';
import { getToken } from '../lib/api';
import { Button, useToast } from './ui';

/** Cópia de segurança: baixa o banco inteiro (pedidos, caixa, clientes, estoque) para guardar no celular ou no Google Drive. */
export default function BackupSettings() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/backup', { headers: { authorization: `Bearer ${getToken()}` } });
      if (!r.ok) throw new Error('Não foi possível gerar a cópia. Tente de novo.');
      const name = /filename="?([^";]+)/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'marmitaria-copia.db';
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.ok('Cópia baixada. Guarde no Google Drive (ou mande para o seu e-mail).');
    } catch (e: any) { toast.err(e.message); }
    finally { setBusy(false); }
  };
  return (
    <section className="card p-4">
      <h2 className="mb-1 flex items-center gap-2 font-bold"><ShieldCheck className="h-5 w-5 text-green-700" />Cópia de segurança</h2>
      <p className="mb-3 text-sm text-slate-500">
        O servidor já guarda uma cópia sozinho todo dia. Para ficar ainda mais seguro, baixe uma cópia <strong>uma vez por semana</strong> e
        guarde no Google Drive: se um dia o servidor sumir, o sistema volta com tudo a partir dela.
      </p>
      <Button variant="secondary" loading={busy} onClick={download}><Download className="h-4 w-4" />Baixar cópia de segurança</Button>
    </section>
  );
}
