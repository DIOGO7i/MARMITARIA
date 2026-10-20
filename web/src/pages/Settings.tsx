import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Settings, useApp } from '../lib/context';
import { centsToInput, milliToInput, parseCents, parseMilli } from '../lib/format';
import { Button, ErrorBox, Field, PageHeader, useAction, useToast } from '../components/ui';
import SecuritySettings from '../components/SecuritySettings';
import TeamSettings from '../components/TeamSettings';
import BackupSettings from '../components/BackupSettings';
import { getScreenMode, ScreenMode, setScreenMode } from '../lib/screen';
import { Monitor, Smartphone, Wand2 } from 'lucide-react';
import { THEME_LABEL, ThemeMode, useTheme } from '../lib/theme';
import { WA_LABELS } from '../lib/whatsapp';

function ListEditor({ label, items, onChange }: { label: string; items: string[]; onChange: (l: string[]) => void }) {
  const [v, setV] = useState('');
  return (
    <section className="card p-4">
      <h2 className="mb-2 font-bold">{label}</h2>
      <div className="flex flex-wrap gap-2">
        {items.map((it, i) => (
          <span key={it + i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm">{it}
            <button aria-label={`Remover ${it}`} onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-600">×</button></span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input aria-label={`Adicionar em ${label}`} className="input" value={v} placeholder="Adicionar…" onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) { e.preventDefault(); if (!items.includes(v.trim())) onChange([...items, v.trim()]); setV(''); } }} />
        <Button variant="secondary" onClick={() => { if (v.trim() && !items.includes(v.trim())) onChange([...items, v.trim()]); setV(''); }}>Adicionar</Button>
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const { settings, reloadSettings, user } = useApp();
  const toast = useToast();
  const [s, setS] = useState<Settings>(() => JSON.parse(JSON.stringify(settings)));
  const [prices, setPrices] = useState(() => settings!.sizes.map((x) => centsToInput(x.priceCents)));
  const [minStock, setMinStock] = useState(milliToInput(settings!.defaultMinStockMilli));
  const kmIn = (m: number) => String(m / 1000).replace('.', ',');
  const [tiers, setTiers] = useState(() => (settings!.deliveryTiers ?? []).map((t) => ({ km: kmIn(t.upToMeters), fee: centsToInput(t.feeCents), cost: centsToInput(t.costCents) })));
  const [dueDays, setDueDays] = useState(String(settings!.dueAlertDays ?? 3));
  const [opts, setOpts] = useState(() => (settings!.menuOptions ?? []).map((o) => ({ ...o, sizes: [...o.sizes] })));
  const act = useAction();
  const owner = user?.role === 'owner';
  const est = (k: keyof Settings['establishment'], v: string) => setS({ ...s, establishment: { ...s.establishment, [k]: v } });

  const save = () => act.run(async () => {
    const sizes = s.sizes.map((x, i) => {
      const p = parseCents(prices[i]);
      if (!x.name.trim()) throw new Error('Todos os tamanhos precisam de nome.');
      if (p === null || p < 0) throw new Error(`Preço inválido para “${x.name}”.`);
      return { name: x.name.trim(), priceCents: p };
    });
    if (new Set(sizes.map((x) => x.name)).size !== sizes.length) throw new Error('Há tamanhos com o mesmo nome.');
    const ms = parseMilli(minStock || '0');
    if (ms === null) throw new Error('Estoque mínimo padrão inválido.');
    const deliveryTiers = tiers.filter((t) => t.km.trim()).map((t) => {
      const km = Number(t.km.replace(',', '.'));
      const fee = parseCents(t.fee || '0'); const cost = parseCents(t.cost || '0');
      if (!Number.isFinite(km) || km < 0.1 || km > 100) throw new Error(`Distância inválida na faixa “até ${t.km} km”.`);
      if (fee === null || fee < 0 || cost === null || cost < 0) throw new Error(`Valores inválidos na faixa “até ${t.km} km”.`);
      return { upToMeters: Math.round(km * 1000), feeCents: fee, costCents: cost };
    }).sort((a, b) => a.upToMeters - b.upToMeters);
    if (new Set(deliveryTiers.map((t) => t.upToMeters)).size !== deliveryTiers.length) throw new Error('Há duas faixas com a mesma distância.');
    const dd = Number(dueDays);
    if (!Number.isInteger(dd) || dd < 0 || dd > 60) throw new Error('Dias de aviso de contas deve ser entre 0 e 60.');
    const menuOptions = opts.map((o) => ({ name: o.name.trim(), description: o.description.trim(), sizes: o.sizes.filter((x) => sizes.some((z) => z.name === x)) }));
    if (menuOptions.some((o) => !o.name)) throw new Error('Toda opção do cardápio precisa de um nome.');
    const { timezone: _tz, ...rest } = s;
    await api('PUT', '/settings', { ...rest, sizes, defaultMinStockMilli: ms, deliveryTiers, dueAlertDays: dd, menuOptions });
    await reloadSettings();
    toast.ok('Configurações salvas.');
  });

  return (
    <div className="max-w-4xl">
      <PageHeader title="Configurações" subtitle="Dados do restaurante, preços, equipe e listas usadas nos cadastros"
        actions={owner && <Button loading={act.busy} onClick={save}>Salvar configurações</Button>} />
      {!owner && <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Somente o responsável pode alterar as configurações.</div>}
      <ErrorBox message={act.error} />
      <fieldset disabled={!owner} className="space-y-4">
        <section className="card grid gap-3 p-4 sm:grid-cols-2">
          <h2 className="font-bold sm:col-span-2">Estabelecimento</h2>
          <Field label="Nome"><input className="input" value={s.establishment.name} onChange={(e) => est('name', e.target.value)} /></Field>
          <Field label="Telefone"><input className="input" value={s.establishment.phone} onChange={(e) => est('phone', e.target.value)} /></Field>
          <Field label="Endereço do restaurante" className="sm:col-span-2" hint="Ponto de partida para calcular a distância até o cliente. Escreva completo: rua, número, bairro, cidade."><input className="input" value={s.establishment.address} onChange={(e) => est('address', e.target.value)} /></Field>
          <Field label="Cidade das entregas" hint="Completa o endereço do cliente no mapa (o cliente só digita rua, número e bairro)."><input className="input" value={s.establishment.city ?? ''} onChange={(e) => est('city', e.target.value)} placeholder="Ribeirão Preto - SP" /></Field>
          <Field label="Horário de funcionamento"><input className="input" placeholder="Seg a sáb, 10h às 15h" value={s.establishment.hours} onChange={(e) => est('hours', e.target.value)} /></Field>
          <Field label="Cabeçalho dos relatórios" hint="Aparece nos relatórios impressos e exportados. Vazio = nome do estabelecimento."><input className="input" value={s.establishment.reportHeader} onChange={(e) => est('reportHeader', e.target.value)} /></Field>
          <Field label="Fuso horário" hint="Datas e horários são exibidos neste fuso."><input className="input" disabled value={s.timezone} /></Field>
        </section>

        <section className="card p-4">
          <h2 className="mb-1 font-bold">Tamanhos de marmita e preços padrão</h2>
          <p className="mb-3 text-sm text-slate-500">O preço padrão é só uma sugestão no cadastro do pedido. Pedidos antigos mantêm o valor registrado.</p>
          <div className="space-y-2">
            {s.sizes.map((x, i) => (
              <div key={i} className="flex gap-2">
                <input aria-label="Nome do tamanho" className="input" value={x.name} onChange={(e) => setS({ ...s, sizes: s.sizes.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) })} />
                <input aria-label="Preço" className="input w-32!" inputMode="decimal" value={prices[i]} onChange={(e) => setPrices(prices.map((p, j) => (j === i ? e.target.value : p)))} />
                <Button variant="ghost" aria-label="Remover tamanho" disabled={s.sizes.length === 1} onClick={() => { setS({ ...s, sizes: s.sizes.filter((_, j) => j !== i) }); setPrices(prices.filter((_, j) => j !== i)); }}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button variant="secondary" onClick={() => { setS({ ...s, sizes: [...s.sizes, { name: '', priceCents: 0 }] }); setPrices([...prices, '0,00']); }}><Plus className="h-4 w-4" />Adicionar tamanho</Button>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <ListEditor label="Formas de pagamento" items={s.paymentMethods} onChange={(l) => setS({ ...s, paymentMethods: l })} />
          <ListEditor label="Categorias de despesas" items={s.expenseCategories} onChange={(l) => setS({ ...s, expenseCategories: l })} />
          {settings!.modules.estoqueCompleto && <ListEditor label="Categorias de produtos" items={s.productCategories} onChange={(l) => setS({ ...s, productCategories: l })} />}
          <ListEditor label="Unidades de medida" items={s.units} onChange={(l) => setS({ ...s, units: l })} />
          <ListEditor label="Observações rápidas do pedido (botões em cada marmita)" items={s.quickNotes ?? []} onChange={(l) => setS({ ...s, quickNotes: l })} />
        </div>

        <section className="card p-4">
          <h2 className="mb-1 font-bold">Modelo do cardápio</h2>
          <p className="mb-3 text-sm text-slate-500">Ponto de partida do <strong>Cardápio do dia</strong>: os nomes dos botões e os tamanhos de cada opção. O prato de cada dia você escreve na tela “Cardápio do dia”.</p>
          <div className="space-y-3">
            {opts.map((o, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
                  <input aria-label="Nome da opção" className="input" value={o.name} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Opção 1" />
                  <input aria-label="Prato do dia" className="input" value={o.description} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder="Descrição padrão (opcional)" />
                  <Button variant="ghost" aria-label="Remover opção" onClick={() => setOpts(opts.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  <span className="text-slate-500">Tamanhos:</span>
                  {s.sizes.filter((z) => z.name.trim()).map((z) => (
                    <label key={z.name} className="flex items-center gap-1.5">
                      <input type="checkbox" checked={o.sizes.includes(z.name)} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? { ...x, sizes: e.target.checked ? [...x.sizes, z.name] : x.sizes.filter((n) => n !== z.name) } : x)))} />{z.name}
                    </label>
                  ))}
                  {o.sizes.filter((n) => s.sizes.some((z) => z.name === n)).length === 0 && <span className="text-xs text-amber-700">Nenhum marcado: a opção mostra todos os tamanhos.</span>}
                </div>
              </div>
            ))}
            {opts.length < 8 && <Button variant="secondary" onClick={() => setOpts([...opts, { name: `Opção ${opts.length + 1}`, description: '', sizes: [] }])}><Plus className="h-4 w-4" />Adicionar opção</Button>}
            {opts.length === 0 && <p className="text-xs text-slate-500">Sem opções: o pedido mostra só os tamanhos, sem os botões.</p>}
          </div>
        </section>

        <section className="card p-4">
          <h2 className="mb-1 font-bold">Taxa de entrega pela distância</h2>
          <p className="mb-3 text-sm text-slate-500">Não precisa cadastrar bairros. No pedido, ao escolher o endereço, o sistema mede a distância pelas ruas a partir do restaurante e preenche o frete e o pagamento do entregador pela faixa abaixo. Acima da maior faixa, você informa o frete na hora.</p>
          <div className="space-y-2">
            {tiers.length > 0 && <div className="hidden grid-cols-12 gap-2 text-xs font-semibold uppercase text-slate-500 sm:grid"><span className="col-span-3">Até (km)</span><span className="col-span-4">Frete cobrado (R$)</span><span className="col-span-4">Pago ao entregador (R$)</span></div>}
            {tiers.map((t, i) => (
              <div key={i} className="grid grid-cols-12 items-end gap-2 border-b border-slate-100 pb-3 last:border-0 sm:items-center sm:border-0 sm:pb-0">
                <label className="col-span-12 flex items-center gap-2 sm:col-span-3"><span className="text-sm text-slate-500 sm:hidden">Até</span>
                  <input aria-label="Até quantos km" className="input" inputMode="decimal" value={t.km} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, km: e.target.value } : x)))} /><span className="text-sm text-slate-500">km</span></label>
                <label className="col-span-5 sm:col-span-4"><span className="mb-0.5 block text-xs text-slate-500 sm:hidden">Frete cobrado (R$)</span>
                  <input aria-label="Frete cobrado" className="input" inputMode="decimal" value={t.fee} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, fee: e.target.value } : x)))} /></label>
                <label className="col-span-5 sm:col-span-4"><span className="mb-0.5 block text-xs text-slate-500 sm:hidden">Entregador (R$)</span>
                  <input aria-label="Pago ao entregador" className="input" inputMode="decimal" value={t.cost} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} /></label>
                <Button variant="ghost" className="col-span-2 self-end sm:col-span-1 sm:self-auto" aria-label="Remover faixa" onClick={() => setTiers(tiers.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button variant="secondary" onClick={() => setTiers([...tiers, { km: tiers.length ? kmIn(Number(tiers[tiers.length - 1].km.replace(',', '.')) * 1000 + 2000) : '2', fee: '0,00', cost: '0,00' }])}><Plus className="h-4 w-4" />Adicionar faixa</Button>
          </div>
        </section>

        <section className="card p-4">
          <h2 className="mb-1 font-bold">Impressora da cozinha</h2>
          <p className="mb-3 text-sm text-slate-500">Todo pedido registrado sai impresso: no computador da cozinha com a tela <strong>Cozinha</strong> aberta, ou direto no celular com <strong>impressora Bluetooth</strong> (ligue isso em <strong>Cozinha (impressora)</strong>, no próprio celular).</p>
          {(() => { const k = s.kitchenPrint ?? { enabled: true, paper: '80', copies: 1, printEdits: true, printCancels: true, showPrices: true }; const setK = (p: Partial<typeof k>) => setS({ ...s, kitchenPrint: { ...k, ...p } as any }); return (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2"><input type="checkbox" checked={k.enabled} onChange={(e) => setK({ enabled: e.target.checked })} />Imprimir todo pedido novo automaticamente</label>
              <Field label="Largura do papel"><select className="input" value={k.paper} onChange={(e) => setK({ paper: e.target.value as any })}><option value="80">80 mm (a mais comum)</option><option value="58">58 mm (impressora pequena)</option></select></Field>
              <Field label="Tamanho da letra"><select className="input" value={k.small ? 'menor' : 'normal'} onChange={(e) => setK({ small: e.target.value === 'menor' } as any)}><option value="normal">Normal (bem grande, para ler de longe)</option><option value="menor">Menor (comanda mais curta)</option></select></Field>
              <Field label="Vias de cada comanda"><select className="input" value={k.copies} onChange={(e) => setK({ copies: Number(e.target.value) })}><option value={1}>1 via</option><option value={2}>2 vias (cozinha + entregador)</option><option value={3}>3 vias</option></select></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={k.printEdits} onChange={(e) => setK({ printEdits: e.target.checked })} />Imprimir de novo quando o pedido for alterado (sai escrito “PEDIDO ALTERADO”)</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={k.printCancels} onChange={(e) => setK({ printCancels: e.target.checked })} />Imprimir aviso quando o pedido for cancelado</label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={!!(k as any).noAccents} onChange={(e) => setK({ noAccents: e.target.checked } as any)} />Impressora Bluetooth: tirar os acentos (marque se sair “Ã§” ou símbolos estranhos no lugar de ç, ã, é)</label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={k.showPrices} onChange={(e) => setK({ showPrices: e.target.checked })} />Mostrar na comanda se está pago ou quanto cobrar (útil para o entregador)</label>
            </div>
          ); })()}
        </section>

        <section className="card p-4">
          <h2 className="mb-1 font-bold">Mensagens de WhatsApp</h2>
          <p className="mb-3 text-sm text-slate-500">Usadas no botão “Avisar no WhatsApp” do pedido. Pode usar: <code>{'{nome}'}</code> <code>{'{numero}'}</code> <code>{'{total}'}</code> <code>{'{itens}'}</code> <code>{'{previsao}'}</code> <code>{'{estabelecimento}'}</code></p>
          <div className="grid gap-3 md:grid-cols-2">
            {Object.keys(WA_LABELS).map((k) => (
              <Field key={k} label={WA_LABELS[k]}><textarea className="input" rows={3} value={s.whatsappTemplates?.[k] ?? ''} onChange={(e) => setS({ ...s, whatsappTemplates: { ...s.whatsappTemplates, [k]: e.target.value } })} /></Field>
            ))}
          </div>
        </section>

        <section className="card p-4">
          <h2 className="mb-1 font-bold">Aviso de contas a pagar</h2>
          <Field label="Avisar contas que vencem nos próximos (dias)" hint="Contas vencidas sempre aparecem." className="max-w-xs"><input className="input" inputMode="numeric" value={dueDays} onChange={(e) => setDueDays(e.target.value)} /></Field>
        </section>

        <section className="card p-4">
          <Field label="Estoque mínimo padrão para novos produtos" className="max-w-xs"><input className="input" inputMode="decimal" value={minStock} onChange={(e) => setMinStock(e.target.value)} /></Field>
        </section>
      </fieldset>
      {owner && <div className="mt-4"><Button loading={act.busy} onClick={save}>Salvar configurações</Button></div>}
      {owner && <div className="mt-6"><BackupSettings /></div>}
      <div className="mt-6"><TeamSettings /></div>
      <div className="mt-6"><AppearanceSettings /></div>
      <div className="mt-6"><SecuritySettings /></div>
    </div>
  );
}

export function AppearanceSettings() {
  const { mode, setMode } = useTheme();
  const tela = getScreenMode();
  const TELAS: { k: ScreenMode; t: string; d: string; icon: any }[] = [
    { k: 'auto', t: 'Automático', d: 'Se ajusta sozinho: celular no celular, computador no computador.', icon: Wand2 },
    { k: 'celular', t: 'Celular', d: 'Botões grandes e barra embaixo. No computador, aparece numa moldura de celular.', icon: Smartphone },
    { k: 'computador', t: 'Computador', d: 'Tela completa, com o menu do lado. No celular, fica como a versão de computador.', icon: Monitor },
  ];
  return (
    <section className="card p-4">
      <h2 className="mb-1 font-bold">Aparência</h2>
      <p className="mb-3 text-sm text-slate-500">Vale só para este aparelho. Cada pessoa pode escolher o seu.</p>
      <div className="label">Tela</div>
      <div className="mb-4 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Tela">
        {TELAS.map(({ k, t, d, icon: I }) => (
          <button key={k} type="button" role="radio" aria-checked={tela === k} onClick={() => tela !== k && setScreenMode(k)}
            className={`flex items-start gap-3 rounded-xl border-2 p-3 text-left text-sm transition-colors ${tela === k ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300'}`}>
            <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tela === k ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600'}`}><I className="h-5 w-5" aria-hidden /></span>
            <span><strong className={`block ${tela === k ? 'text-brand-700' : ''}`}>{t}{k === 'auto' && <span className="ml-1 text-xs font-normal text-slate-500">(recomendado)</span>}</strong><span className="text-xs text-slate-500">{d}</span></span>
          </button>
        ))}
      </div>
      <div className="label">Tema</div>
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Tema">
        {(['claro', 'escuro', 'auto'] as ThemeMode[]).map((m) => (
          <label key={m} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${mode === m ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700' : 'border-slate-300'}`}>
            <input type="radio" name="tema" className="accent-current" checked={mode === m} onChange={() => setMode(m)} />
            {m === 'claro' ? '☀️' : m === 'escuro' ? '🌙' : '🖥️'} {THEME_LABEL[m]}
          </label>
        ))}
      </div>
    </section>
  );
}
