import { useCallback, useEffect, useRef, useState } from 'react';
import { Bluetooth, CheckCircle2, Monitor, Pause, Play, Printer, RotateCcw, Smartphone, WifiOff } from 'lucide-react';
import { DeviceMode, diagnoseRawBT, flushBluetooth, getDeviceMode, isAndroid, setDeviceMode, testBluetooth } from '../lib/btprint';
import { getRawbtFormat, RawbtFormat, setRawbtFormat } from '../lib/escpos';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { printTicket, ticketHtml, TicketKind } from '../lib/ticket';
import { Badge, Button, PageHeader, useToast } from '../components/ui';

// Tela que fica aberta no computador da cozinha, ligado à impressora.
// A cada poucos segundos busca as comandas novas e imprime sozinha, uma por vez.

const KIND: Record<string, { label: string; cls: string }> = {
  novo: { label: 'Novo', cls: 'bg-green-100 text-green-800' },
  alterado: { label: 'Alterado', cls: 'bg-amber-100 text-amber-900' },
  cancelado: { label: 'Cancelado', cls: 'bg-red-100 text-red-800' },
  reaberto: { label: 'Reaberto', cls: 'bg-blue-100 text-blue-800' },
  reimpressao: { label: '2ª via', cls: 'bg-slate-100 text-slate-700' },
};
const EVERY = 4000;

function beep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.18);
    setTimeout(() => ctx.close(), 400);
  } catch { /* sem som */ }
}

export default function Kitchen() {
  const { settings } = useApp();
  const toast = useToast();
  const [on, setOn] = useState(false);
  const [fmt, setFmt] = useState<RawbtFormat>(getRawbtFormat);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const running = useRef(false);
  const wake = useRef<any>(null);
  const cfg = settings!.kitchenPrint;
  const [mode, setModeState] = useState<DeviceMode>(getDeviceMode());
  const [pending, setPending] = useState(0);
  const chooseMode = (m: DeviceMode) => { setDeviceMode(m); setModeState(m); if (m === 'bluetooth') setOn(false); };
  const bt = mode === 'bluetooth';

  const loadRecent = useCallback(() => api<any[]>('GET', '/kitchen/recent').then(setRecent).catch(() => {}), []);
  useEffect(() => { loadRecent(); }, [loadRecent]);

  const tick = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const jobs = await api<{ id: number; kind: TicketKind; order: any }[]>('GET', '/kitchen/queue');
      setOffline(false); setLastCheck(new Date());
      for (const j of jobs) {
        const c = await api<{ ok: boolean }>('POST', `/kitchen/jobs/${j.id}/claim`);
        if (!c.ok) continue; // outra tela já imprimiu
        beep(); setBusy(true);
        await printTicket(ticketHtml(j.order, j.kind, settings!), settings!.kitchenPrint?.paper);
        setBusy(false); setCount((n) => n + 1);
      }
      if (jobs.length) loadRecent();
    } catch { setOffline(true); }
    finally { running.current = false; setBusy(false); }
  }, [settings, loadRecent]);

  useEffect(() => {
    if (!on) return;
    tick();
    const t = setInterval(tick, EVERY);
    return () => clearInterval(t);
  }, [on, tick]);

  // tela sempre acesa enquanto estiver imprimindo
  useEffect(() => {
    if (!on) return;
    const ask = async () => { try { wake.current = await (navigator as any).wakeLock?.request('screen'); } catch { /* sem suporte */ } };
    ask();
    const vis = () => { if (document.visibilityState === 'visible') ask(); };
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); wake.current?.release?.().catch(() => {}); };
  }, [on]);

  useEffect(() => {
    if (!bt) return;
    const look = () => api<any[]>('GET', '/kitchen/queue').then((j) => { setPending(j.length); setOffline(false); }).catch(() => setOffline(true));
    look(); const t = setInterval(look, EVERY); return () => clearInterval(t);
  }, [bt]);
  const printPending = async () => {
    try { const n = await flushBluetooth(settings!); toast.ok(n ? `${n} comanda(s) mandada(s) para a impressora.` : 'Nada esperando para imprimir.'); setPending(0); loadRecent(); }
    catch (e: any) { toast.err(e.message); }
  };

  const start = () => { beep(); setOn(true); };
  const again = async (orderId: number, n: number) => {
    try {
      await api('POST', `/orders/${orderId}/print`);
      if (bt) { await flushBluetooth(settings!); toast.ok(`Pedido #${n} mandado para a impressora.`); loadRecent(); return; }
      toast.ok(`Pedido #${n} vai sair de novo.`); if (on) tick(); else toast.err('Ligue a impressão automática para imprimir.');
    }
    catch (e: any) { toast.err(e.message); }
  };
  const test = () => bt ? testBluetooth(settings!) : printTicket(ticketHtml({
    number: 0, orderTime: new Date().toTimeString().slice(0, 5), source: 'presencial', deliveryType: 'retirada', customerName: 'Teste da impressora',
    items: [{ qty: 2, size: '450 g', option: 'Opção 1', optionDescription: 'Arroz, feijão, frango empanado', notes: 'sem salada' }], totalCents: 2800, paidCents: 2800, paymentMethod: 'Pix',
  }, 'teste', settings!), settings!.kitchenPrint?.paper);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Cozinha" subtitle="Todo pedido sai impresso na cozinha: pelo computador com impressora ou pelo celular com impressora Bluetooth." />

      {!cfg?.enabled && <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">A impressão automática está desligada nas Configurações. Os pedidos não entram na fila.</div>}

      <section className="card mb-4 p-4">
        <h2 className="mb-2 font-bold">Como este aparelho imprime</h2>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Impressora deste aparelho">
          {([
            ['nenhuma', Monitor, 'Computador com impressora', 'Deixa esta tela aberta e imprime sozinho'],
            ['bluetooth', Smartphone, 'Celular com impressora Bluetooth', 'Ex.: 5808 Printer, pelo app RawBT'],
          ] as const).map(([k, Icon, t, d]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => chooseMode(k)}
              className={`flex items-start gap-3 rounded-xl border p-3 text-left ${mode === k ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-300 hover:bg-slate-50'}`}>
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${mode === k ? 'text-brand-700' : 'text-slate-500'}`} />
              <span><strong className="block text-sm">{t}</strong><span className="text-xs text-slate-500">{d}</span></span>
            </button>
          ))}
        </div>
        {bt && !isAndroid() && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">A impressão Bluetooth pelo RawBT só funciona em celular <strong>Android</strong>.</p>}
      </section>

      {bt ? (
        <section className="card mb-4 p-5">
          <div className="flex flex-wrap items-center gap-4">
            <span className={`flex h-12 w-12 items-center justify-center rounded-full ${offline ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
              {offline ? <WifiOff className="h-6 w-6" /> : <Bluetooth className="h-6 w-6" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-bold">Impressora Bluetooth ligada neste celular</div>
              <div className="text-sm text-slate-500">Ao registrar, alterar ou cancelar um pedido aqui, a comanda sai na hora.</div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button className="py-3! text-base" onClick={printPending}><Printer className="h-5 w-5" />{pending ? `Imprimir ${pending} esperando` : 'Imprimir o que estiver esperando'}</Button>
            <Button variant="secondary" onClick={test}>Imprimir teste</Button>
          </div>
          <details className="mt-4 rounded-lg border border-slate-200 p-3 text-sm">
            <summary className="cursor-pointer font-semibold">Saiu só o aviso do RawBT? Faça estes testes</summary>
            <p className="mt-2 text-slate-600">Toque em cada um e veja qual imprime o texto <strong>além</strong> do aviso “versão gratuita”. Depois escolha abaixo o jeito que funcionou.</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(['A', 'B', 'C', 'D'] as const).map((k) => (
                <Button key={k} variant="secondary" onClick={() => diagnoseRawBT(k, settings!)}>
                  Teste {k}<span className="text-xs font-normal text-slate-500">{k === 'A' ? ' texto' : k === 'B' ? ' base64' : k === 'C' ? ' comanda base64' : ' comanda texto'}</span>
                </Button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Jeito de mandar para o RawBT">
              <span className="font-medium">Jeito de mandar:</span>
              {([['base64', 'Base64 (B / C)'], ['texto', 'Texto (A / D)']] as [RawbtFormat, string][]).map(([k, t]) => (
                <button key={k} type="button" role="radio" aria-checked={fmt === k} onClick={() => { setRawbtFormat(k); setFmt(k); }}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${fmt === k ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300'}`}>{t}</button>
              ))}
            </div>
          </details>
          <p className="mt-3 text-right text-xs text-slate-400">Versão {__APP_VERSION__}</p>
        </section>
      ) : (
        <section className={`card mb-4 p-5 ${on ? 'border-green-300' : ''}`}>
        {on ? (
          <div className="flex flex-wrap items-center gap-4">
            <span className={`flex h-12 w-12 items-center justify-center rounded-full ${offline ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
              {offline ? <WifiOff className="h-6 w-6" /> : busy ? <Printer className="h-6 w-6 animate-pulse" /> : <CheckCircle2 className="h-6 w-6" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-bold">{offline ? 'Sem conexão com o sistema' : busy ? 'Imprimindo…' : 'Ligada · esperando pedidos'}</div>
              <div className="text-sm text-slate-500">
                {offline ? 'Confira a internet. Os pedidos ficam guardados e saem assim que voltar.' : `${count} comanda(s) impressa(s) nesta tela${lastCheck ? ` · conferido às ${lastCheck.toLocaleTimeString('pt-BR')}` : ''}`}
              </div>
            </div>
            <Button variant="secondary" onClick={() => setOn(false)}><Pause className="h-4 w-4" />Pausar</Button>
          </div>
        ) : (
          <div className="text-center">
            <Printer className="mx-auto mb-2 h-10 w-10 text-brand-600" />
            <p className="mb-3 text-slate-600">A impressão automática está parada nesta tela.</p>
            <Button className="px-6! py-3! text-base" onClick={start}><Play className="h-5 w-5" />Ligar impressão automática</Button>
          </div>
        )}
      </section>
      )}

      <section className="card p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="font-bold">Últimas comandas</h2>
          {!bt && <Button variant="ghost" className="text-xs" onClick={test}><Printer className="h-4 w-4" />Imprimir teste</Button>}
        </div>
        {recent.length === 0 ? <p className="text-sm text-slate-500">Nenhuma comanda nas últimas 12 horas.</p> : (
          <ul className="divide-y divide-slate-100">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <strong className="w-14 text-lg">#{r.number}</strong>
                <span className="min-w-0 flex-1 truncate">{r.customerName || (r.deliveryType === 'entrega' ? 'Entrega' : 'Retirada')}</span>
                <Badge cls={KIND[r.kind]?.cls ?? ''}>{KIND[r.kind]?.label ?? r.kind}</Badge>
                <span className="w-24 text-right text-xs text-slate-500">{r.printedAt ? `saiu ${new Date(r.printedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'na fila'}</span>
                <Button variant="ghost" className="px-2! py-1! text-xs" onClick={() => again(r.orderId, r.number)}><RotateCcw className="h-3.5 w-3.5" />De novo</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {bt && <details open className="card mt-4 p-4 text-sm">
        <summary className="cursor-pointer font-bold">Como ligar a impressora Bluetooth (uma vez só)</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-slate-700">
          <li>Ligue a impressora e, no celular, vá em <strong>Configurações → Bluetooth</strong> e pareie com <strong>“5808 Printer”</strong> (se pedir senha: <strong>0000</strong> ou <strong>1234</strong>).</li>
          <li>Instale o app <strong>RawBT</strong> pela Play Store (é grátis).</li>
          <li>Abra o RawBT → <strong>Configurações</strong>: em <em>Conexão</em> escolha <strong>Bluetooth</strong> e a 5808; em <em>Impressora</em>, papel <strong>58 mm</strong>. Em <em>Codificação</em>, se tiver, escolha <strong>CP860 (Português)</strong>.</li>
          <li>Volte aqui e toque em <strong>Imprimir teste</strong>. Na primeira vez o Android pergunta se pode abrir o RawBT: marque <strong>Sempre</strong>.</li>
          <li>Se os acentos saírem errados, a responsável marca <strong>“tirar os acentos”</strong> em Configurações → Impressora da cozinha.</li>
        </ol>
        <p className="mt-2 text-slate-500">Papel: {cfg?.paper === '80' ? '80 mm' : '58 mm'} · {cfg?.copies ?? 1} via(s). Para a 5808, use 58 mm em Configurações → Impressora da cozinha.</p>
      </details>}

      {!bt && <details className="card mt-4 p-4 text-sm">
        <summary className="cursor-pointer font-bold">Como deixar a impressora pronta (uma vez só)</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-slate-700">
          <li>Ligue a impressora no computador da cozinha e deixe ela como <strong>impressora padrão</strong> do Windows.</li>
          <li>Abra o sistema pelo atalho <strong>INICIAR-COZINHA</strong> (vem junto com o sistema). Ele abre o navegador já nesta tela e imprimindo <strong>sem perguntar</strong>.</li>
          <li>Entre com um acesso de funcionário (por exemplo “Cozinha”), toque em <strong>Ligar impressão automática</strong> e depois em <strong>Imprimir teste</strong>.</li>
          <li>Se aparecer a janela de impressão a cada pedido, o navegador não foi aberto pelo atalho: feche e abra pelo INICIAR-COZINHA.</li>
        </ol>
        <p className="mt-2 text-slate-500">Papel: {cfg?.paper === '58' ? '58 mm' : '80 mm'} · {cfg?.copies ?? 1} via(s). A responsável muda isso em Configurações → Impressora da cozinha.</p>
      </details>}
    </div>
  );
}
