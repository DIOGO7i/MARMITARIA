import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, CopyPlus, MessageCircle, Minus, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { addDays } from '../lib/dates';
import { dateBR, money } from '../lib/format';
import { DayItems, DayMenuOption, EMPTY_ITEMS, menuText, ruleText, SwapGroup, waShare, weekdayBR } from '../lib/whatsapp';
import MenuImage from '../components/MenuImage';
import { DayItemsEditor } from '../components/DayItemsEditor';
import { Button, ErrorBox, Field, PageHeader, useAction, useToast } from '../components/ui';

interface MenuData {
  date: string; saved: boolean; options: DayMenuOption[]; swaps: SwapGroup[]; items: DayItems; updatedAt: string | null; updatedBy: string | null;
  previous: { date: string; options: DayMenuOption[]; swaps?: SwapGroup[]; items?: DayItems } | null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const norm = (o: DayMenuOption): DayMenuOption => ({ name: o.name, description: o.description, sizes: o.sizes, soldOut: !!o.soldOut, carnes: o.carnes ?? 1, guarnicoes: o.guarnicoes ?? 1 });

/** Quantas carnes/guarnições a opção leva: − 1 + */
function Count({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 text-sm font-medium">{label}</span>
      <div className="flex items-center rounded-lg border-2 border-slate-300" role="group" aria-label={label}>
        <button type="button" aria-label={`Menos ${label.toLowerCase()}`} disabled={value <= 0} onClick={() => onChange(value - 1)} className="h-9 w-9 font-bold disabled:opacity-30"><Minus className="mx-auto h-4 w-4" /></button>
        <span className="w-8 text-center text-lg font-bold">{value}</span>
        <button type="button" aria-label={`Mais ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)} className="h-9 w-9 font-bold disabled:opacity-30"><Plus className="mx-auto h-4 w-4" /></button>
      </div>
    </div>
  );
}

export default function MenuPage() {
  const { settings, today } = useApp();
  const toast = useToast();
  const base = settings!.marmitaBase ?? 'Arroz e feijão';
  const [date, setDate] = useState(today);
  const [data, setData] = useState<MenuData | null>(null);
  const [opts, setOpts] = useState<DayMenuOption[]>([]);
  const [items, setItems] = useState<DayItems>(EMPTY_ITEMS);
  const [loadError, setLoadError] = useState<string | null>(null);
  const act = useAction();

  const load = useCallback(async () => {
    setLoadError(null); setData(null);
    try { const m = await api<MenuData>('GET', `/menu/${date}`); setData(m); setOpts(m.options.map(norm)); setItems(m.items ?? EMPTY_ITEMS); }
    catch (e: any) { setLoadError(e.message); }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  // o que vai para o servidor: a descrição de cada opção é a regra ("Arroz e feijão + 1 carne + 2 guarnições")
  const ready = useMemo(() => opts.map((o) => ({ ...norm(o), description: ruleText(o, base) })), [opts, base]);
  const groups = useMemo(() => [
    { title: 'Carnes do dia', items: items.carnes.filter((x) => !x.soldOut).map((x) => x.name) },
    { title: 'Guarnições do dia', items: items.guarnicoes.filter((x) => !x.soldOut).map((x) => x.name) },
  ], [items]);
  const dirty = !!data && (!data.saved || !same(ready, data.options.map((o) => ({ ...norm(o), description: ruleText(o, base) })))
    || !same(items, data.items ?? EMPTY_ITEMS) || (data.swaps ?? []).some((g) => g.items.length > 0));
  const text = useMemo(() => menuText(ready, settings!, date, today, groups), [ready, settings, date, today, groups]);
  const upd = (i: number, p: Partial<DayMenuOption>) => setOpts((l) => l.map((o, j) => (j === i ? { ...o, ...p } : o)));
  const toggleSize = (i: number, size: string) => {
    const cur = opts[i].sizes.length ? opts[i].sizes : settings!.sizes.map((s) => s.name);
    const next = cur.includes(size) ? cur.filter((s) => s !== size) : [...cur, size];
    if (next.length === 0) { toast.err('Deixe pelo menos um tamanho nessa opção.'); return; }
    upd(i, { sizes: settings!.sizes.map((s) => s.name).filter((s) => next.includes(s)) });
  };

  const save = () => act.run(async () => {
    const empty = opts.findIndex((o) => !o.name.trim());
    if (empty >= 0) throw new Error(`Dê um nome para a opção ${empty + 1}.`);
    if (opts.some((o) => (o.carnes ?? 0) > 0) && !items.carnes.length) throw new Error('Coloque pelo menos uma carne do dia.');
    if (opts.some((o) => (o.guarnicoes ?? 0) > 0) && !items.guarnicoes.length) throw new Error('Coloque pelo menos uma guarnição do dia.');
    // as trocas antigas (v21/v30) saem: agora tudo é escolhido por botões
    const m = await api<MenuData>('PUT', `/menu/${date}`, { options: ready, swaps: [], items });
    setData(m); setOpts(m.options.map(norm)); setItems(m.items ?? EMPTY_ITEMS);
    toast.ok(date === today ? 'Cardápio de hoje salvo. Os botões do pedido já mostram o que tem.' : `Cardápio de ${dateBR(date)} salvo.`);
  });

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.ok('Texto do cardápio copiado.'); }
    catch { toast.err('Não foi possível copiar. Selecione o texto abaixo e copie manualmente.'); }
  };
  const repeat = () => {
    const p = data!.previous!;
    setOpts(p.options.map((o) => norm({ ...o, soldOut: false })));
    if (p.items) setItems({ carnes: p.items.carnes.map((x) => ({ ...x, soldOut: false })), guarnicoes: p.items.guarnicoes.map((x) => ({ ...x, soldOut: false })) });
  };

  return (
    <div className="pb-24 sm:pb-0">
      <PageHeader title="Cardápio do dia" subtitle="Monte de manhã: as carnes e as guarnições do dia. No pedido, a atendente escolhe tocando nos botões." />

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
            <button onClick={repeat}
              className="mb-3 flex w-full items-center gap-2 rounded-lg border border-dashed border-brand-500 bg-brand-50 px-3 py-2.5 text-left text-sm font-semibold text-brand-700">
              <CopyPlus className="h-4 w-4 shrink-0" />Repetir o cardápio de {dateBR(data.previous.date)} e só ajustar
            </button>
          )}
          <ErrorBox message={act.error} />

          <div className="grid gap-3 lg:grid-cols-2">
            <DayItemsEditor title="Carnes do dia" hint="Cada uma vira um botão no pedido. Pode digitar várias separadas por vírgula."
              placeholder="Ex.: Frango empanado, Bisteca, Almôndegas" items={items.carnes} onChange={(carnes) => setItems((x) => ({ ...x, carnes }))} />
            <DayItemsEditor title="Guarnições do dia" hint={`${base ? `${base} já vem em toda marmita. ` : ''}Aqui vão as guarnições para escolher.`}
              placeholder="Ex.: Purê, Farofa, Creme de milho" items={items.guarnicoes} onChange={(guarnicoes) => setItems((x) => ({ ...x, guarnicoes }))} />
          </div>

          <h2 className="mt-5 mb-1 font-bold">Opções</h2>
          <p className="mb-2 text-sm text-slate-500">Quanto cada opção leva. Normalmente fica igual todo dia.</p>
          <div className="grid gap-3 lg:grid-cols-2">
            {opts.map((o, i) => {
              const active = o.sizes.length ? o.sizes : settings!.sizes.map((s) => s.name);
              return (
                <section key={i} className={`card space-y-3 p-4 ${o.soldOut ? 'opacity-70' : ''}`}>
                  <div className="flex items-end gap-2">
                    <Field label="Nome do botão" className="flex-1"><input className="input font-bold" maxLength={40} value={o.name} onChange={(e) => upd(i, { name: e.target.value })} /></Field>
                    {opts.length > 1 && <Button variant="ghost" className="p-2!" aria-label={`Remover ${o.name || 'opção'}`} title="Remover opção" onClick={() => setOpts((l) => l.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}
                  </div>
                  <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800">{ruleText(o, base) || 'Nada para escolher'}</p>
                  <div className="space-y-2">
                    <Count label="Carnes" value={o.carnes ?? 1} max={3} onChange={(n) => upd(i, { carnes: n })} />
                    <Count label="Guarnições" value={o.guarnicoes ?? 1} max={4} onChange={(n) => upd(i, { guarnicoes: n })} />
                  </div>
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
            <Button variant="secondary" className="mt-3" onClick={() => setOpts((l) => [...l, { name: `Opção ${l.length + 1}`, description: '', sizes: [], soldOut: false, carnes: 1, guarnicoes: 1 }])}>
              <Plus className="h-4 w-4" />Adicionar opção
            </Button>
          )}

          <MenuImage options={ready} swaps={groups} date={date} />

          <section className="card mt-4 p-4">
            <h2 className="mb-2 flex items-center gap-2 font-bold"><MessageCircle className="h-4 w-4" />Mandar o cardápio no WhatsApp</h2>
            <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-700">{text}</pre>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={waShare(text)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-green-700"><MessageCircle className="h-4 w-4" />Abrir no WhatsApp</a>
              <Button variant="secondary" onClick={copy}><Copy className="h-4 w-4" />Copiar texto</Button>
            </div>
            <p className="mt-2 text-xs text-slate-500">O WhatsApp abre para você escolher o contato, grupo ou status. O que está marcado como “esgotou” não entra no texto.</p>
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
