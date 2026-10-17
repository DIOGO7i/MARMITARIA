import { useCallback, useEffect, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Lock, Printer, Unlock } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { centsToInput, dateBR, instantBR, money, parseCents } from '../lib/format';
import { Badge, Button, Confirm, ErrorBox, Field, Modal, PageHeader, useAction, useToast } from '../components/ui';

export default function Cash() {
  const { today, user, settings } = useApp();
  const toast = useToast();
  const [day, setDay] = useState(today);
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState('');
  const [mov, setMov] = useState<'sangria' | 'suprimento' | null>(null);
  const [closing, setClosing] = useState(false);
  const [reopen, setReopen] = useState(false);
  const act = useAction();

  const load = useCallback(() => api('GET', `/cash/${day}`).then((r) => { setD(r); setError(null); setOpening(centsToInput(r.suggestedOpeningCents)); }).catch((e) => setError(e.message)), [day]);
  useEffect(() => { load(); }, [load]);

  const open = () => act.run(async () => {
    const c = parseCents(opening || '0');
    if (c === null || c < 0) throw new Error('Troco inicial inválido.');
    setD(await api('POST', `/cash/${day}/open`, { openingCents: c }));
    toast.ok('Caixa aberto.');
  });

  const isOpen = d?.status === 'aberto';
  const closed = d?.status === 'fechado';
  // quem decide o que é dinheiro é o servidor (mesma regra da conta da gaveta)
  const nonCash = (d?.received ?? []).filter((r: any) => !r.cash && !r.unknown);
  const cashPaidOut = (d?.paidOut ?? []).filter((r: any) => r.cash);
  // antes de fechar, busca de novo: outra pessoa pode ter lançado algo enquanto a tela estava aberta
  const startClose = () => act.run(async () => { const r = await api('GET', `/cash/${day}`); setD(r); if (r.status === 'aberto') setClosing(true); });

  return (
    <div className="max-w-4xl">
      <PageHeader title="Caixa do dia" subtitle="Abertura, sangrias e conferência do dinheiro no fechamento"
        actions={<>
          <input aria-label="Dia" type="date" className="input w-auto!" value={day} onChange={(e) => setDay(e.target.value)} />
          {closed && <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" />Imprimir</Button>}
        </>} />
      <ErrorBox message={error} />
      <ErrorBox message={act.error} />
      {!d ? <p className="text-slate-500">Carregando…</p> : (
        <div className="print-area space-y-4">
          <div className="hidden print:block"><strong>{settings!.establishment.name}</strong> — Fechamento de caixa de {dateBR(day)}</div>
          <div className="flex flex-wrap items-center gap-2">
            {d.status === 'nao_aberto' && <Badge cls="bg-slate-200 text-slate-700">Caixa não aberto</Badge>}
            {isOpen && <Badge cls="bg-green-100 text-green-800"><Unlock className="h-3 w-3" />Caixa aberto</Badge>}
            {closed && <Badge cls="bg-blue-100 text-blue-800"><Lock className="h-3 w-3" />Fechado em {instantBR(d.closedAt)}</Badge>}
          </div>

          {d.status === 'nao_aberto' && (
            <section className="card p-4">
              <h2 className="mb-1 font-bold">Abrir o caixa de {dateBR(day)}</h2>
              <p className="mb-3 text-sm text-slate-500">Informe quanto dinheiro tem na gaveta para troco.{d.suggestedOpeningCents > 0 && ' Já preenchemos com o valor deixado no último fechamento.'}</p>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Troco inicial (R$)"><input className="input w-40!" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} /></Field>
                <Button loading={act.busy} onClick={open}>Abrir caixa</Button>
              </div>
            </section>
          )}

          {closed && d.changedAfterCloseCents !== 0 && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <strong>Teve lançamento em dinheiro depois do fechamento.</strong> Com a data deste dia {d.changedAfterCloseCents > 0 ? 'entrou' : 'saiu'} mais {money(Math.abs(d.changedAfterCloseCents))} em dinheiro depois que o caixa foi fechado. O fechamento abaixo não inclui esse valor.
              {user?.role === 'owner' ? ' Reabra o caixa e feche de novo para conferir.' : ' Peça ao responsável para reabrir e fechar de novo.'}
            </div>
          )}
          {(d.unknownMethodCents !== 0 || d.unknownMethodPaidCents !== 0) && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <strong>Tem valor sem forma de pagamento neste dia</strong>
              {d.unknownMethodCents !== 0 && <> ({money(d.unknownMethodCents)} recebido)</>}{d.unknownMethodPaidCents !== 0 && <> ({money(d.unknownMethodPaidCents)} pago)</>}.
              {' '}Ele não entra na conta da gaveta. Se foi em dinheiro, a conta abaixo está errada: abra o pedido, a compra ou a despesa e escolha a forma.
            </div>
          )}

          <section className="card p-4">
            <h2 className="mb-3 font-bold">Dinheiro na gaveta</h2>
            <dl className="space-y-1.5 text-sm">
              <Row label="Troco inicial" value={money(d.openingCents)} />
              <Row label="+ Recebido em dinheiro" value={money(d.cashInCents)} tone="good" />
              <Row label="+ Suprimentos (dinheiro colocado)" value={money(d.supplyCents)} tone="good" />
              <Row label="− Pagamentos feitos em dinheiro" value={money(d.cashOutCents)} tone="bad" />
              <Row label="− Sangrias (dinheiro retirado)" value={money(d.bleedCents)} tone="bad" />
              {closed && d.changedAfterCloseCents !== 0 && (
                <Row label={d.changedAfterCloseCents > 0 ? '− Entrou depois do fechamento (fora desta conferência)' : '+ Saiu depois do fechamento (fora desta conferência)'} value={money(Math.abs(d.changedAfterCloseCents))} tone="bad" />
              )}
              <div className="border-t border-slate-200 pt-2"><Row label={closed ? '= Dinheiro que deveria ter na gaveta no fechamento' : '= Dinheiro que deveria ter na gaveta'} value={money(d.expectedCashCents)} strong /></div>
              {closed && <>
                <Row label="Dinheiro contado" value={money(d.countedCashCents)} strong />
                <Row label={d.differenceCents === 0 ? 'Diferença' : d.differenceCents > 0 ? 'Sobrou' : 'Faltou'} value={money(Math.abs(d.differenceCents))} tone={d.differenceCents === 0 ? 'good' : 'bad'} strong />
                <Row label="Deixado na gaveta para o próximo dia" value={money(d.leftInDrawerCents)} />
              </>}
            </dl>
            {isOpen && (
              <div className="no-print mt-4 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setMov('sangria')}><ArrowUpCircle className="h-4 w-4" />Sangria (retirar)</Button>
                <Button variant="secondary" onClick={() => setMov('suprimento')}><ArrowDownCircle className="h-4 w-4" />Suprimento (colocar)</Button>
                <Button className="ml-auto" loading={act.busy} onClick={startClose}><Lock className="h-4 w-4" />Fechar caixa</Button>
              </div>
            )}
            {closed && user?.role === 'owner' && <div className="no-print mt-4"><Button variant="ghost" onClick={() => setReopen(true)}><Unlock className="h-4 w-4" />Reabrir caixa</Button></div>}
          </section>

          <section className="card p-4">
            <h2 className="mb-3 font-bold">Recebido no dia por forma de pagamento</h2>
            {d.received.length === 0 ? <p className="text-sm text-slate-500">Nenhum recebimento registrado neste dia.</p> : (
              <table className="w-full text-sm">
                <thead><tr><th className="th">Forma</th><th className="th text-right">Recebimentos</th><th className="th text-right">Sistema</th>{closed && <th className="th text-right">Conferido</th>}</tr></thead>
                <tbody className="divide-y divide-slate-100">{d.received.map((r: any) => {
                  const chk = d.checks?.[r.method];
                  return (
                    <tr key={r.method}><td className="td">{r.method}</td><td className="td text-right">{r.count}</td><td className="td text-right font-semibold">{money(r.totalCents)}</td>
                      {closed && <td className="td text-right">{chk === undefined ? '—' : <span className={chk === r.totalCents ? 'text-green-700' : 'font-semibold text-red-700'}>{money(chk)}{chk !== r.totalCents && ` (${chk > r.totalCents ? '+' : '−'}${money(Math.abs(chk - r.totalCents))})`}</span>}</td>}
                    </tr>
                  );
                })}</tbody>
                <tfoot><tr><td className="td font-bold">Total</td><td /><td className="td text-right font-bold">{money(d.totalReceivedCents)}</td>{closed && <td />}</tr></tfoot>
              </table>
            )}
            <p className="mt-2 text-xs text-slate-500">Estornos de pedidos cancelados entram com valor negativo, na data do cancelamento.</p>
          </section>

          {(d.movements.length > 0 || cashPaidOut.length > 0) && (
            <section className="card p-4">
              <h2 className="mb-3 font-bold">Movimentos do caixa</h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {d.movements.map((m: any) => (
                  <li key={m.id} className="flex justify-between gap-2 py-1.5"><span>{m.kind === 'sangria' ? '↑ Sangria' : '↓ Suprimento'}: {m.reason} <span className="text-xs text-slate-500">· {instantBR(m.createdAt)}{m.userName ? ` · ${m.userName}` : ''}</span></span>
                    <strong className={m.kind === 'sangria' ? 'text-red-700' : 'text-green-700'}>{m.kind === 'sangria' ? '−' : '+'}{money(m.amountCents)}</strong></li>
                ))}
                {cashPaidOut.map((p: any) => <li key={'p' + p.method} className="flex justify-between py-1.5"><span>Contas e compras pagas em {p.method.toLowerCase()} ({p.count})</span><strong className="text-red-700">−{money(p.totalCents)}</strong></li>)}
              </ul>
            </section>
          )}
          {closed && d.notes && <p className="text-sm"><strong>Observações:</strong> {d.notes}</p>}
        </div>
      )}

      {mov && <MovementModal kind={mov} onClose={() => setMov(null)} onSubmit={async (amountCents, reason) => { setD(await api('POST', `/cash/${day}/movements`, { kind: mov, amountCents, reason })); setMov(null); toast.ok(mov === 'sangria' ? 'Sangria registrada.' : 'Suprimento registrado.'); }} />}
      {closing && d && <CloseModal d={d} nonCash={nonCash} onClose={() => setClosing(false)} onSubmit={async (b) => { setD(await api('POST', `/cash/${day}/close`, b)); setClosing(false); toast.ok('Caixa fechado.'); }} />}
      {reopen && <Confirm title="Reabrir o caixa?" message="O fechamento será desfeito para você corrigir lançamentos e fechar de novo. Fica registrado no histórico." confirmLabel="Reabrir" onClose={() => setReopen(false)}
        onConfirm={async () => { try { setD(await api('POST', `/cash/${day}/reopen`)); setReopen(false); toast.ok('Caixa reaberto.'); } catch (e: any) { toast.err(e.message); } }} />}
    </div>
  );
}

function Row({ label, value, tone, strong }: { label: string; value: string; tone?: 'good' | 'bad'; strong?: boolean }) {
  return <div className="flex justify-between gap-2"><dt className={strong ? 'font-semibold' : 'text-slate-600'}>{label}</dt><dd className={`${strong ? 'text-base font-bold' : 'font-semibold'} ${tone === 'good' ? 'text-green-700' : tone === 'bad' ? 'text-red-700' : ''}`}>{value}</dd></div>;
}

function MovementModal({ kind, onClose, onSubmit }: { kind: 'sangria' | 'suprimento'; onClose: () => void; onSubmit: (c: number, r: string) => Promise<void> }) {
  const [v, setV] = useState(''); const [r, setR] = useState('');
  const act = useAction();
  return (
    <Modal title={kind === 'sangria' ? 'Sangria: retirar dinheiro do caixa' : 'Suprimento: colocar dinheiro no caixa'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
      <Button loading={act.busy} onClick={() => act.run(async () => { const c = parseCents(v); if (!c || c <= 0) throw new Error('Informe o valor.'); if (!r.trim()) throw new Error('Informe o motivo.'); await onSubmit(c, r); })}>Registrar</Button></>}>
      <ErrorBox message={act.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Valor (R$)"><input className="input" autoFocus inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} /></Field>
        <Field label="Motivo"><input className="input" placeholder={kind === 'sangria' ? 'ex.: depósito no banco' : 'ex.: mais troco'} value={r} onChange={(e) => setR(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function CloseModal({ d, nonCash, onClose, onSubmit }: { d: any; nonCash: any[]; onClose: () => void; onSubmit: (b: any) => Promise<void> }) {
  const [counted, setCounted] = useState(''); const [left, setLeft] = useState(() => centsToInput(d.openingCents)); const [notes, setNotes] = useState('');
  const [checks, setChecks] = useState<Record<string, string>>({});
  const act = useAction();
  const c = parseCents(counted || '');
  const diff = c === null ? null : c - d.expectedCashCents;
  return (
    <Modal wide title="Fechar o caixa" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Voltar</Button>
      <Button loading={act.busy} onClick={() => act.run(async () => {
        if (c === null || c < 0) throw new Error('Informe o dinheiro contado na gaveta.');
        const l = parseCents(left || '0');
        if (l === null || l < 0 || l > c) throw new Error('O valor deixado na gaveta para amanhã não pode ser maior que o dinheiro contado.');
        const ch: Record<string, number> = {};
        for (const [k, v] of Object.entries(checks)) { if (v.trim()) { const x = parseCents(v); if (x === null) throw new Error(`Valor conferido inválido em ${k}.`); ch[k] = x; } }
        await onSubmit({ countedCashCents: c, leftInDrawerCents: l, checks: ch, notes });
      })}>Fechar caixa</Button></>}>
      <ErrorBox message={act.error} />
      <p className="mb-3 text-sm">Conte o dinheiro da gaveta. O sistema calcula que deveria ter <strong>{money(d.expectedCashCents)}</strong>.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Dinheiro contado (R$)"><input className="input" autoFocus inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
        <Field label="Deixar na gaveta p/ amanhã (R$)" hint="Vira o troco inicial do próximo dia. Já vem com o troco de hoje."><input className="input" inputMode="decimal" value={left} onChange={(e) => setLeft(e.target.value)} /></Field>
        <div className="self-center text-sm">{diff !== null && (diff === 0 ? <span className="font-semibold text-green-700">✔ Bateu certinho</span> : <span className="font-semibold text-red-700">{diff > 0 ? 'Sobrou' : 'Faltou'} {money(Math.abs(diff))}</span>)}</div>
      </div>
      {nonCash.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-bold">Conferir outras formas (opcional)</h3>
          <p className="mb-2 text-xs text-slate-500">Digite o total que aparece na maquininha ou no app do banco para comparar com o sistema.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {nonCash.map((r: any) => <Field key={r.method} label={`${r.method} (sistema: ${money(r.totalCents)})`}><input className="input" inputMode="decimal" value={checks[r.method] ?? ''} onChange={(e) => setChecks({ ...checks, [r.method]: e.target.value })} /></Field>)}
          </div>
        </div>
      )}
      <Field label="Observações" className="mt-3"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Modal>
  );
}
