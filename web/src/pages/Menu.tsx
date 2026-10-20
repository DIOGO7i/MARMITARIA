import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, CopyPlus, MessageCircle, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { addDays } from '../lib/dates';
import { dateBR, money } from '../lib/format';
import { DayMenuOption, menuText, SwapGroup, waShare, weekdayBR } from '../lib/whatsapp';
import { PartsEditor } from '../components/PartsEditor';
import MenuImage from '../components/MenuImage';
import { Button, ErrorBox, Field, PageHeader, useAction, useToast } from '../components/ui';

interface MenuData { date: string; saved: boolean; options: DayMenuOption[]; swaps: SwapGroup[]; updatedAt: string | null; updatedBy: string | null; previous: { date: string; options: DayMenuOption[]; swaps?: SwapGroup[] } | null }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Montagem por partes no formulário: as trocas são digitadas separadas por vírgula
type PartDraft = { label: string; value: string; swapsText: string };
type OptDraft = Omit<DayMenuOption, 'parts'> & { parts: PartDraft[] };
const splitList = (t: string) => t.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
const NEW_PARTS: PartDraft[] = [
  { label: 'Acompanhamento', value: 'Arroz e feijão', swapsText: '' },
  { label: 'Carne', value: '', swapsText: '' },
  { label: 'Guarnição', value: '', swapsText: '' },
  { label: 'Salada', value: '', swapsText: '' },
];
/** Opção salva → formulário. Opção antiga (só com descrição) vira uma parte por item. */
const toDraftOpt = (o: DayMenuOption): OptDraft => ({
  ...o,
  parts: o.parts?.length ? o.parts.map((p) => ({ label: p.label, value: p.value, swapsText: p.swaps.join(', ') }))
    : o.description.trim() ? splitList(o.description).map((v) => ({ label: '', value: v, swapsText: '' }))
    : NEW_PARTS.map((p) => ({ ...p })),
});
/** Formulário → como vai para o servidor (a descrição sai das partes). */
const fromDraftOpt = (d: OptDraft): DayMenuOption => {
  const parts = d.parts.map((p) => ({ label: p.label.trim(), value: p.value.trim(), swaps: splitList(p.swapsText) })).filter((p) => p.value || p.swaps.length);
  return { name: d.name, description: parts.map((p) => p.value).filter(Boolean).join(', '), sizes: d.sizes, soldOut: !!d.soldOut, parts };
};

export default function MenuPage() {
  const { settings, today } = useApp();
  const toast = useToast();
  const [date, setDate] = useState(today);
  const [data, setData] = useState<MenuData | null>(null);
  const [opts, setOpts] = useState<OptDraft[]>([]);
  const ready = useMemo(() => opts.map(fromDraftOpt), [opts]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const act = useAction();

  const load = useCallback(async () => {
    setLoadError(null); setData(null);
    try { const m = await api<MenuData>('GET', `/menu/${date}`); setData(m); setOpts(m.options.map(toDraftOpt)); }
    catch (e: any) { setLoadError(e.message); }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const dirty = !!data && (!data.saved || !same(ready, data.options.map((o) => fromDraftOpt(toDraftOpt(o)))) || (data.swaps ?? []).some((g) => g.items.length > 0));
  const text = useMemo(() => menuText(ready, settings!, date, today), [ready, settings, date, today]);
  const upd = (i: number, p: Partial<OptDraft>) => setOpts((l) => l.map((o, j) => (j === i ? { ...o, ...p } : o)));
  const toggleSize = (i: number, size: string) => {
    const cur = opts[i].sizes.length ? opts[i].sizes : settings!.sizes.map((s) => s.name);
    const next = cur.includes(size) ? cur.filter((s) => s !== size) : [...cur, size];
    if (next.length === 0) { toast.err('Deixe pelo menos um tamanho nessa opção.'); return; }
    upd(i, { sizes: settings!.sizes.map((s) => s.name).filter((s) => next.includes(s)) });
  };

  const save = () => act.run(async () => {
    const empty = opts.findIndex((o) => !o.name.trim());
    if (empty >= 0) throw new Error(`Dê um nome para a opção ${empty + 1}.`);
    if (opts.some((o) => o.sizes.length === 0 && settings!.sizes.length === 0)) throw new Error('Cadastre os tamanhos nas Configurações.');
    const semNada = ready.find((o) => !o.parts?.length);
    if (semNada) throw new Error(`Diga o que vai na ${semNada.name}.`);
    // as trocas agora ficam em cada opção; a lista antiga do dia (v21) é limpa
    const m = await api<MenuData>('PUT', `/menu/${date}`, { options: ready, swaps: [] });
    setData(m); setOpts(m.options.map(toDraftOpt));
    toast.ok(date === today ? 'Cardápio de hoje salvo. Os botões do pedido já mostram o que tem.' : `Cardápio de ${dateBR(date)} salvo.`);
  });

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.ok('Texto do cardápio copiado.'); }
    catch { toast.err('Não foi possível copiar. Selecione o texto abaixo e copie manualmente.'); }
  };

  return (
    <div className="pb-24 sm:pb-0">
      <PageHeader title="Cardápio do dia" subtitle="Monte de manhã, antes do movimento. Na hora do pedido, é só tocar na opção." />

      <div className="card mb-3 flex flex-wrap items-end gap-2 p-3">
        <Field label="Cardápio de"><input type="date" className="input w-auto!" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
        <div className="flex gap-1">
          <Button variant={date === today ? 'primary' : 'secondary'} onClick={() => setDate(today)}>Hoje</Button>
          <Button variant={date === addDays(today, 1) ? 'primary' : 'secondary'} onClick={() => setDate(addDays(today, 1))}>Amanhã</Button>
        </div>
        <p className="w-full text-sm text-slate-500 sm:w-auto sm:flex-1 sm:text-right">
          <span>{weekdayBR(date).replace(/^./, (c) => c.toUpperCase())}</span>
          {data?.saved ? <> · salvo{data.updatedBy ? ` por ${data.updatedBy}` : ''}</> : data ? <> · <strong className="text-amber-700">ainda não montado</strong></> : null}
        </p>
      </div>

      <ErrorBox message={loadError} />
      {loadError && <Button variant="secondary" onClick={load}>Tentar novamente</Button>}
      {!data && !loadError && <p className="text-slate-500">Carregando…</p>}

      {data && (
        <>
          {!data.saved && data.previous && (
            <button onClick={() => setOpts(data.previous!.options.map((o) => toDraftOpt({ ...o, soldOut: false })))}
              className="mb-3 flex w-full items-center gap-2 rounded-lg border border-dashed border-brand-500 bg-brand-50 px-3 py-2.5 text-left text-sm font-semibold text-brand-700">
              <CopyPlus className="h-4 w-4 shrink-0" />Repetir o cardápio de {dateBR(data.previous.date)} ({data.previous.options.map((o) => o.name).join(', ')}) e só ajustar
            </button>
          )}
          <ErrorBox message={act.error} />

          <div className="grid gap-3 lg:grid-cols-2">
            {opts.map((o, i) => {
              const active = o.sizes.length ? o.sizes : settings!.sizes.map((s) => s.name);
              return (
                <section key={i} className={`card space-y-3 p-4 ${o.soldOut ? 'opacity-70' : ''}`}>
                  <div className="flex items-end gap-2">
                    <Field label="Nome do botão" className="flex-1"><input className="input font-bold" maxLength={40} value={o.name} onChange={(e) => upd(i, { name: e.target.value })} /></Field>
                    {opts.length > 1 && <Button variant="ghost" className="p-2!" aria-label={`Remover ${o.name || 'opção'}`} title="Remover opção" onClick={() => setOpts((l) => l.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}
                  </div>
                  <PartsEditor option={o.name || `Opção ${i + 1}`} parts={o.parts} onChange={(parts) => upd(i, { parts })} />
                  <Field label="Tamanhos dessa opção">
                    <div className="flex flex-wrap gap-2">
                      {settings!.sizes.map((s) => {
                        const on = active.includes(s.name);
                        return (
                          <button key={s.name} type="button" aria-pressed={on} onClick={() => toggleSize(i, s.name)}
                            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${on ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300 bg-white text-slate-600'}`}>
                            {s.name} · {money(s.priceCents)}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" className="h-4 w-4" checked={!!o.soldOut} onChange={(e) => upd(i, { soldOut: e.target.checked })} />
                    Esgotou (não aparece para novos pedidos)
                  </label>
                </section>
              );
            })}
          </div>
          {opts.length < 8 && (
            <Button variant="secondary" className="mt-3" onClick={() => setOpts((l) => [...l, { name: `Opção ${l.length + 1}`, description: '', sizes: [], soldOut: false, parts: NEW_PARTS.map((p) => ({ ...p })) }])}>
              <Plus className="h-4 w-4" />Adicionar opção
            </Button>
          )}

          <MenuImage options={ready} swaps={[]} date={date} />

          <section className="card mt-4 p-4">
            <h2 className="mb-2 flex items-center gap-2 font-bold"><MessageCircle className="h-4 w-4" />Mandar o cardápio no WhatsApp</h2>
            <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-700">{text}</pre>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={waShare(text)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-green-700"><MessageCircle className="h-4 w-4" />Abrir no WhatsApp</a>
              <Button variant="secondary" onClick={copy}><Copy className="h-4 w-4" />Copiar texto</Button>
            </div>
            <p className="mt-2 text-xs text-slate-500">O WhatsApp abre para você escolher o contato, grupo ou status. Opções marcadas como “esgotou” não entram no texto.</p>
          </section>

          <div className="fixed inset-x-0 bottom-[var(--nav-h)] z-30 border-t border-slate-200 bg-white p-3 sm:static sm:mt-4 sm:border-0 sm:bg-transparent sm:p-0">
            <Button className="w-full py-3! text-base sm:w-auto" loading={act.busy} disabled={!dirty} onClick={save}>
              <Save className="h-5 w-5" />{dirty ? (date === today ? 'Salvar cardápio de hoje' : `Salvar cardápio de ${dateBR(date)}`) : 'Cardápio salvo'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
