import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, History, Minus, PackageX, Pencil, Plus, Scale, Search, Truck, CheckCircle2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useApp } from '../lib/context';
import { centsToInput, dateTimeBR, milliToInput, money, parseCents, parseMilli, qty, REASON } from '../lib/format';
import { Badge, Button, Empty, ErrorBox, Field, Modal, PageHeader, useAction, useToast } from '../components/ui';

export function StockBadge({ s }: { s: string }) {
  if (s === 'sem_estoque') return <Badge cls="bg-red-100 text-red-800"><PackageX className="h-3 w-3" />Sem estoque</Badge>;
  if (s === 'baixo') return <Badge cls="bg-amber-100 text-amber-800"><AlertTriangle className="h-3 w-3" />Estoque baixo</Badge>;
  return <Badge cls="bg-green-100 text-green-800"><CheckCircle2 className="h-3 w-3" />OK</Badge>;
}

export default function Stock() {
  const { settings, user } = useApp();
  // o estoque completo mostra custo e valor: só para a responsável
  return settings!.modules.estoqueCompleto && user?.role === 'owner' ? <FullStock /> : <SimpleStock />;
}

/** Estoque simples: quanto tem de cada coisa e o que está acabando. As compras somam sozinhas. */
function SimpleStock() {
  const { user } = useApp();
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const [onlyLow, setOnlyLow] = useState(params.get('acabando') === '1');
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const [used, setUsed] = useState<any | null>(null);
  const [count, setCount] = useState<any | null>(null);
  const [history, setHistory] = useState<any | null>(null);

  const load = useCallback(() => api('GET', '/products' + qs({ q, active: '1' })).then((r) => { setRows(r); setError(null); }).catch((e) => setError(e.message)), [q]);
  useEffect(() => { load(); }, [load]);
  const low = rows?.filter((r) => r.stockStatus !== 'ok') ?? [];
  const shown = onlyLow ? low : rows ?? [];

  return (
    <div>
      <PageHeader title="Estoque" subtitle="Quanto tem de cada coisa. As compras somam sozinhas; use “Usei” ou “Contei” para acertar."
        actions={<Button onClick={() => setEdit({})}><Plus className="h-4 w-4" />Novo item</Button>} />
      <div className="card mb-3 flex flex-wrap items-center gap-2 p-3">
        <label className="relative min-w-48 flex-1"><span className="sr-only">Buscar item</span><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Buscar pelo nome" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <button onClick={() => setOnlyLow((v) => !v)} aria-pressed={onlyLow}
          className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold ${onlyLow ? 'bg-amber-500 text-white' : 'border border-amber-300 bg-amber-50 text-amber-800'}`}>
          <AlertTriangle className="h-4 w-4" />Acabando{rows ? ` (${low.length})` : ''}
        </button>
      </div>
      <ErrorBox message={error} />
      <div className="card overflow-hidden">
        {!rows ? <p className="p-4 text-slate-500">Carregando…</p> : shown.length === 0 ? (
          onlyLow ? <Empty title="Nada acabando 👍" hint="Todos os itens estão acima do mínimo que você definiu." />
            : <Empty title="Nenhum item no estoque" hint="Cadastre o que você quer acompanhar (arroz, feijão, carnes, marmitex…). Ao lançar uma compra, a quantidade soma sozinha."
              action={<Button onClick={() => setEdit({})}><Plus className="h-4 w-4" />Cadastrar item</Button>} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-sm"><strong className={p.stockStatus === 'ok' ? '' : p.stockStatus === 'baixo' ? 'text-amber-700' : 'text-red-700'}>{qty(p.qtyMilli)} {p.unit}</strong>
                    {p.minQtyMilli > 0 && <span className="text-slate-500"> · avisa abaixo de {qty(p.minQtyMilli)}</span>}</div>
                </div>
                {p.stockStatus !== 'ok' && <StockBadge s={p.stockStatus} />}
                <div className="ml-auto flex gap-1">
                  <Button variant="secondary" className="px-2.5! py-1.5!" onClick={() => setUsed(p)} disabled={p.qtyMilli <= 0}><Minus className="h-4 w-4" />Usei</Button>
                  {user?.role === 'owner' && <Button variant="secondary" className="px-2.5! py-1.5!" onClick={() => setCount(p)}><Scale className="h-4 w-4" />Contei</Button>}
                  <Button variant="ghost" className="p-1.5!" title="Histórico" aria-label={`Histórico de ${p.name}`} onClick={() => setHistory(p)}><History className="h-4 w-4" /></Button>
                  <Button variant="ghost" className="p-1.5!" title="Editar" aria-label={`Editar ${p.name}`} onClick={() => setEdit(p)}><Pencil className="h-4 w-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {edit && <ProductForm simple product={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {used && <UsedModal product={used} onClose={() => setUsed(null)} onSaved={() => { setUsed(null); load(); }} />}
      {count && <AdjustModal simple product={count} onClose={() => setCount(null)} onSaved={() => { setCount(null); load(); }} />}
      {history && <MovementHistory product={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function UsedModal({ product, onClose, onSaved }: { product: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<'consumo' | 'perda'>('consumo');
  const act = useAction();
  const save = () => act.run(async () => {
    const m = parseMilli(amount);
    if (!m) throw new Error('Informe quanto saiu.');
    if (m > product.qtyMilli) throw new Error(`No sistema só tem ${qty(product.qtyMilli)} ${product.unit}. Se a quantidade real é outra, use “Contei”.`);
    const r = await api('POST', '/stock/out', { productId: product.id, qtyMilli: m, reason, notes: reason === 'perda' ? 'Estragou / perdeu' : null });
    toast.ok(`Registrado. Agora tem ${qty(r.balanceMilli)} ${product.unit} de ${product.name}.`);
    onSaved();
  });
  return (
    <Modal title={`Saiu do estoque — ${product.name}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={act.busy} onClick={save}>Registrar</Button></>}>
      <ErrorBox message={act.error} />
      <div className="space-y-3">
        <Field label={`Quanto saiu (${product.unit})`} hint={`Tem ${qty(product.qtyMilli)} ${product.unit} agora.`}><input className="input text-lg" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} /></Field>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Motivo">
          {([['consumo', 'Usei na cozinha'], ['perda', 'Estragou / perdeu']] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={reason === k} onClick={() => setReason(k)}
              className={`rounded-lg border-2 px-3 py-2 text-sm font-semibold ${reason === k ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300'}`}>{l}</button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function FullStock() {
  const { user } = useApp();
  const [f, setF] = useState({ q: '', status: '', active: '1' });
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const [history, setHistory] = useState<any | null>(null);
  const [adjust, setAdjust] = useState<any | null>(null);
  const [suppliers, setSuppliers] = useState(false);

  const load = useCallback(() => api('GET', '/products' + qs(f)).then((r) => { setRows(r); setError(null); }).catch((e) => setError(e.message)), [f]);
  useEffect(() => { load(); }, [load]);

  const low = rows?.filter((r) => r.active && r.stockStatus === 'baixo').length ?? 0;
  const out = rows?.filter((r) => r.active && r.stockStatus === 'sem_estoque').length ?? 0;

  return (
    <div>
      <PageHeader title="Estoque" subtitle="Mercadorias e insumos. O saldo só muda por compras, saídas ou ajustes — tudo fica no histórico."
        actions={<>
          <Button variant="secondary" onClick={() => setSuppliers(true)}><Truck className="h-4 w-4" />Fornecedores</Button>
          <Button onClick={() => setEdit({})}><Plus className="h-4 w-4" />Novo produto</Button>
        </>} />

      {(low > 0 || out > 0) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {out > 0 && <button onClick={() => setF({ ...f, status: 'sem_estoque' })} className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"><PackageX className="h-4 w-4" />{out} produto(s) sem estoque</button>}
          {low > 0 && <button onClick={() => setF({ ...f, status: 'baixo' })} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800"><AlertTriangle className="h-4 w-4" />{low} produto(s) com estoque baixo</button>}
        </div>
      )}

      <div className="card mb-3 grid gap-2 p-3 sm:grid-cols-4">
        <label className="relative sm:col-span-2"><span className="sr-only">Buscar produto</span><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Buscar produto pelo nome" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></label>
        <select aria-label="Situação do estoque" className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Toda situação</option><option value="ok">OK</option><option value="baixo">Estoque baixo</option><option value="sem_estoque">Sem estoque</option></select>
        <select aria-label="Ativo" className="input" value={f.active} onChange={(e) => setF({ ...f, active: e.target.value })}><option value="1">Ativos</option><option value="0">Inativos</option><option value="">Todos</option></select>
      </div>

      <ErrorBox message={error} />
      <div className="card overflow-hidden">
        {!rows ? <p className="p-4 text-slate-500">Carregando…</p> : rows.length === 0 ? (
          <Empty title="Nenhum produto encontrado" hint="Cadastre os insumos que você compra (arroz, feijão, carnes, embalagens…). Depois registre as compras para dar entrada no estoque."
            action={<Button onClick={() => setEdit({})}><Plus className="h-4 w-4" />Cadastrar produto</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="bg-slate-50"><tr><th className="th">Produto</th><th className="th">Categoria</th><th className="th text-right">Saldo</th><th className="th text-right">Mínimo</th><th className="th text-right">Custo unit.</th><th className="th text-right">Valor</th><th className="th">Situação</th><th className="th text-right">Ações</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => (
                  <tr key={p.id} className={!p.active ? 'opacity-60' : ''}>
                    <td className="td font-semibold">{p.name}{!p.active && <span className="ml-1 text-xs font-normal">(inativo)</span>}<div className="text-xs font-normal text-slate-500">{p.supplierName}</div></td>
                    <td className="td">{p.category || '—'}</td>
                    <td className="td whitespace-nowrap text-right font-semibold">{qty(p.qtyMilli)} {p.unit}</td>
                    <td className="td whitespace-nowrap text-right">{qty(p.minQtyMilli)} {p.unit}</td>
                    <td className="td text-right">{money(p.unitCostCents)}/{p.unit}</td>
                    <td className="td text-right">{money(p.valueCents)}</td>
                    <td className="td"><StockBadge s={p.stockStatus} /></td>
                    <td className="td"><div className="flex justify-end gap-1">
                      <Button variant="ghost" className="p-1.5!" title="Histórico" aria-label="Histórico" onClick={() => setHistory(p)}><History className="h-4 w-4" /></Button>
                      {user?.role === 'owner' && <Button variant="ghost" className="p-1.5!" title="Ajuste de inventário" aria-label="Ajuste de inventário" onClick={() => setAdjust(p)}><Scale className="h-4 w-4" /></Button>}
                      <Button variant="ghost" className="p-1.5!" title="Editar" aria-label="Editar" onClick={() => setEdit(p)}><Pencil className="h-4 w-4" /></Button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && <ProductForm product={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {history && <MovementHistory product={history} onClose={() => setHistory(null)} />}
      {adjust && <AdjustModal product={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); load(); }} />}
      {suppliers && <SuppliersModal onClose={() => setSuppliers(false)} />}
    </div>
  );
}

function ProductForm({ product, onClose, onSaved, simple }: { product: any | null; onClose: () => void; onSaved: () => void; simple?: boolean }) {
  const { settings } = useApp();
  const toast = useToast();
  const [sups, setSups] = useState<any[]>([]);
  useEffect(() => { if (!simple) api('GET', '/suppliers').then(setSups).catch(() => {}); }, [simple]);
  const [f, setF] = useState({
    name: product?.name ?? '', category: product?.category ?? '', unit: product?.unit ?? settings!.units[0],
    qty: '', min: product ? milliToInput(product.minQtyMilli) : milliToInput(settings!.defaultMinStockMilli),
    cost: product?.unitCostCents != null ? centsToInput(product.unitCostCents) : '0,00', supplierId: product?.supplierId ? String(product.supplierId) : '',
    notes: product?.notes ?? '', active: product?.active ?? true,
  });
  const act = useAction();
  const save = () => act.run(async () => {
    const min = parseMilli(f.min || '0'); const cost = parseCents(f.cost || '0'); const q = f.qty ? parseMilli(f.qty) : 0;
    if (!f.name.trim()) throw new Error('Informe o nome.');
    if (min === null) throw new Error('Estoque mínimo inválido.');
    if (cost === null || cost < 0) throw new Error('Custo unitário inválido.');
    if (q === null) throw new Error('Saldo inicial inválido.');
    const body = { name: f.name, category: f.category || null, unit: f.unit, minQtyMilli: min, unitCostCents: cost, supplierId: f.supplierId ? Number(f.supplierId) : null, notes: f.notes, active: f.active, ...(product ? {} : { qtyMilli: q }) };
    if (product) await api('PUT', `/products/${product.id}`, body); else await api('POST', '/products', body);
    toast.ok(product ? 'Item atualizado.' : 'Item cadastrado.');
    onSaved();
  });
  if (simple) return (
    <Modal title={product ? `Editar ${product.name}` : 'Novo item do estoque'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={act.busy} onClick={save}>Salvar</Button></>}>
      <ErrorBox message={act.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome" className="sm:col-span-2"><input className="input" autoFocus placeholder="Ex.: Arroz, Frango, Marmitex 750 ml" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Medida"><select className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{settings!.units.map((u) => <option key={u}>{u}</option>)}{!settings!.units.includes(f.unit) && <option>{f.unit}</option>}</select></Field>
        {product ? (
          <Field label="Tem agora" hint="Para mudar, use “Usei” ou “Contei”."><input className="input" disabled value={`${qty(product.qtyMilli)} ${product.unit}`} /></Field>
        ) : (
          <Field label={`Quanto tem agora (${f.unit})`}><input className="input" inputMode="decimal" placeholder="0" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
        )}
        <Field label={`Avisar quando ficar abaixo de (${f.unit})`} hint="Deixe 0 para não avisar." className="sm:col-span-2"><input className="input" inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></Field>
        {product && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={!f.active} onChange={(e) => setF({ ...f, active: !e.target.checked })} />Não uso mais este item (esconder da lista)</label>}
      </div>
    </Modal>
  );
  return (
    <Modal title={product ? `Editar ${product.name}` : 'Novo produto'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={act.busy} onClick={save}>Salvar</Button></>}>
      <ErrorBox message={act.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome do produto" className="sm:col-span-2"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Categoria"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">—</option>{settings!.productCategories.map((c) => <option key={c}>{c}</option>)}{f.category && !settings!.productCategories.includes(f.category) && <option>{f.category}</option>}</select></Field>
        <Field label="Unidade de medida"><select className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{settings!.units.map((u) => <option key={u}>{u}</option>)}{!settings!.units.includes(f.unit) && <option>{f.unit}</option>}</select></Field>
        {product ? (
          <Field label="Quantidade atual" hint="Para alterar, registre uma compra, saída ou ajuste de inventário."><input className="input" disabled value={`${qty(product.qtyMilli)} ${product.unit}`} /></Field>
        ) : (
          <Field label="Saldo inicial (opcional)" hint="Gera uma movimentação “Saldo inicial” no histórico."><input className="input" inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
        )}
        <Field label="Estoque mínimo"><input className="input" inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></Field>
        <Field label={`Custo unitário (R$/${f.unit})`} hint={product ? 'Atualizado automaticamente a cada compra (custo médio).' : undefined}><input className="input" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
        <Field label="Fornecedor (opcional)"><select className="input" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">—</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Observações" className="sm:col-span-2"><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Produto ativo</label>
      </div>
    </Modal>
  );
}

function MovementHistory({ product, onClose }: { product: any; onClose: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api('GET', '/stock/movements' + qs({ productId: product.id, limit: 500 })).then(setRows).catch((e) => setErr(e.message)); }, [product.id]);
  return (
    <Modal wide title={`Histórico — ${product.name}`} onClose={onClose}>
      <ErrorBox message={err} />
      {!rows ? 'Carregando…' : rows.length === 0 ? <Empty title="Nenhuma movimentação" hint="Registre uma compra para dar entrada neste produto." /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50"><tr><th className="th">Data/hora</th><th className="th">Motivo</th><th className="th text-right">Anterior</th><th className="th text-right">Entrou</th><th className="th text-right">Saiu</th><th className="th text-right">Posterior</th><th className="th">Usuário</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((m) => (
            <tr key={m.id}>
              <td className="td whitespace-nowrap">{dateTimeBR(m.occurredAt)}</td>
              <td className="td">{REASON[m.reason] ?? m.reason}{m.purchaseNumber && ` #${m.purchaseNumber}`}{m.notes && <div className="text-xs text-slate-500">{m.notes}</div>}</td>
              <td className="td text-right">{qty(m.balanceBeforeMilli)}</td>
              <td className="td text-right text-green-700">{m.inMilli ? `+${qty(m.inMilli)}` : ''}</td>
              <td className="td text-right text-red-700">{m.outMilli ? `−${qty(m.outMilli)}` : ''}</td>
              <td className="td text-right font-semibold">{qty(m.balanceAfterMilli)}</td>
              <td className="td">{m.userName ?? '—'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Modal>
  );
}

function AdjustModal({ product, onClose, onSaved, simple }: { product: any; onClose: () => void; onSaved: () => void; simple?: boolean }) {
  const toast = useToast();
  const [counted, setCounted] = useState(milliToInput(product.qtyMilli));
  const [notes, setNotes] = useState('');
  const act = useAction();
  const c = parseMilli(counted);
  return (
    <Modal title={simple ? `Contei — ${product.name}` : `Ajuste de inventário — ${product.name}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
      <Button loading={act.busy} onClick={() => act.run(async () => { if (c === null) throw new Error('Quantidade inválida.'); await api('POST', '/stock/adjust', { productId: product.id, countedMilli: c, notes }); toast.ok(simple ? `Pronto: ${product.name} agora com ${counted} ${product.unit}.` : 'Ajuste registrado no histórico.'); onSaved(); })}>{simple ? 'Salvar contagem' : 'Registrar ajuste'}</Button></>}>
      <ErrorBox message={act.error} />
      <p className="mb-3 text-sm text-slate-600">{simple ? 'Conte quanto tem de verdade e digite aqui. O sistema acerta a diferença e guarda no histórico.' : 'Informe a quantidade contada fisicamente. O sistema registra a diferença como movimentação de ajuste (autorizada pelo responsável).'}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Saldo no sistema"><input className="input" disabled value={`${qty(product.qtyMilli)} ${product.unit}`} /></Field>
        <Field label={`Quantidade contada (${product.unit})`}><input className="input" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
        <Field label="Observação" className="sm:col-span-2"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {c !== null && c !== product.qtyMilli && <p className="mt-2 text-sm">Diferença: <strong className={c > product.qtyMilli ? 'text-green-700' : 'text-red-700'}>{c > product.qtyMilli ? '+' : '−'}{qty(Math.abs(c - product.qtyMilli))} {product.unit}</strong></p>}
    </Modal>
  );
}

function SuppliersModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [f, setF] = useState({ id: 0, name: '', cnpj: '', phone: '', notes: '' });
  const act = useAction();
  const load = useCallback(() => api('GET', '/suppliers').then(setRows).catch((e) => act.setError(e.message)), []); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  return (
    <Modal wide title="Fornecedores" onClose={onClose}>
      <ErrorBox message={act.error} />
      <div className="grid gap-2 sm:grid-cols-5">
        <input aria-label="CNPJ" className="input" placeholder="CNPJ (opcional)" value={f.cnpj} onChange={(e) => setF({ ...f, cnpj: e.target.value })} />
        <input aria-label="Nome do fornecedor" className="input" placeholder="Nome" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input aria-label="Telefone" className="input" placeholder="Telefone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <input aria-label="Observações" className="input" placeholder="Observações" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        <div className="flex gap-2">
          <Button loading={act.busy} onClick={() => act.run(async () => {
            if (f.id) await api('PUT', `/suppliers/${f.id}`, f); else await api('POST', '/suppliers', f);
            toast.ok('Fornecedor salvo.'); setF({ id: 0, name: '', cnpj: '', phone: '', notes: '' }); load();
          })}>{f.id ? 'Salvar' : 'Adicionar'}</Button>
          {f.id > 0 && <Button variant="ghost" onClick={() => setF({ id: 0, name: '', cnpj: '', phone: '', notes: '' })}>Cancelar</Button>}
        </div>
      </div>
      {rows.length === 0 ? <Empty title="Nenhum fornecedor cadastrado" /> : (
        <ul className="mt-3 divide-y divide-slate-100 text-sm">{rows.map((s) => (
          <li key={s.id} className="flex items-center justify-between py-2">
            <span><strong>{s.name}</strong> {s.cnpj && <span className="text-slate-500">· CNPJ {s.cnpj}</span>} {s.phone && <span className="text-slate-500">· {s.phone}</span>} {s.notes && <span className="text-xs text-slate-500">· {s.notes}</span>}</span>
            <Button variant="ghost" className="p-1.5!" aria-label="Editar" onClick={() => setF({ id: s.id, name: s.name, cnpj: s.cnpj ?? '', phone: s.phone ?? '', notes: s.notes ?? '' })}><Pencil className="h-4 w-4" /></Button>
          </li>
        ))}</ul>
      )}
    </Modal>
  );
}
