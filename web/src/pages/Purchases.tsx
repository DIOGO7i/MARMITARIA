import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Eye, FileCode2, Loader2, Plus, ScanLine, Trash2 } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useApp } from '../lib/context';
import { centsToInput, dateBR, milliToInput, money, PAY_STATUS, parseCents, parseMilli, qty } from '../lib/format';
import { photoToBase64, readText } from '../lib/image';
import { Badge, Button, Confirm, Empty, ErrorBox, Field, Modal, PageHeader, useAction, useToast } from '../components/ui';
import { PaymentModal } from './Orders';
import { monthRange } from '../lib/dates';

export default function Purchases() {
  const { today } = useApp();
  const m = monthRange(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  const [f, setF] = useState({ from: m.from, to: m.to, status: '', paymentStatus: '', supplierId: '', q: '' });
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const [detail, setDetail] = useState<number | null>(null);
  const [sups, setSups] = useState<any[]>([]);
  useEffect(() => { api('GET', '/suppliers').then(setSups).catch(() => {}); }, [form]);

  const load = useCallback(() => api('GET', '/purchases' + qs(f)).then((r) => { setRows(r); setError(null); }).catch((e) => setError(e.message)), [f]);
  useEffect(() => { load(); }, [load]);
  const valid = rows?.filter((r) => r.status === 'confirmada') ?? [];

  return (
    <div>
      <PageHeader title="Compras e entradas" subtitle="Cada compra confirmada dá entrada no estoque e gera o lançamento financeiro — uma única vez."
        actions={<Button onClick={() => setForm(true)}><Plus className="h-4 w-4" />Nova compra</Button>} />
      <div className="card mb-3 grid gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6">
        <input aria-label="De" type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <input aria-label="Até" type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <select aria-label="Fornecedor" className="input" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">Todo fornecedor</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select aria-label="Pagamento" className="input" value={f.paymentStatus} onChange={(e) => setF({ ...f, paymentStatus: e.target.value })}><option value="">Todo pagamento</option><option value="pendente">A pagar</option><option value="parcial">Parcial</option><option value="pago">Pago</option></select>
        <select aria-label="Situação" className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Todas</option><option value="confirmada">Confirmadas</option><option value="cancelada">Canceladas</option></select>
        <input aria-label="Número ou nota" className="input" placeholder="Nº ou nota fiscal" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
      </div>
      {rows && valid.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-4 text-sm">
          <span>Total comprado: <strong>{money(valid.reduce((a, r) => a + r.totalCents, 0))}</strong></span>
          <span>Pago: <strong className="text-green-700">{money(valid.reduce((a, r) => a + r.paidCents, 0))}</strong></span>
          <span>A pagar: <strong className="text-amber-700">{money(valid.reduce((a, r) => a + r.openCents, 0))}</strong></span>
        </div>
      )}
      <ErrorBox message={error} />
      <div className="card overflow-hidden">
        {!rows ? <p className="p-4 text-slate-500">Carregando…</p> : rows.length === 0 ? (
          <Empty title="Nenhuma compra no período" hint="Registre as compras de mercadorias para atualizar o estoque automaticamente." action={<Button onClick={() => setForm(true)}><Plus className="h-4 w-4" />Nova compra</Button>} />
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px]">
            <thead className="bg-slate-50"><tr><th className="th">Nº</th><th className="th">Data</th><th className="th">Fornecedor</th><th className="th">Itens</th><th className="th text-right">Total</th><th className="th text-right">Pago</th><th className="th">Pagamento</th><th className="th"></th></tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map((p) => (
              <tr key={p.id} className={p.status === 'cancelada' ? 'opacity-60' : ''}>
                <td className="td font-bold">#{p.number}</td>
                <td className="td">{dateBR(p.purchaseDate)}</td>
                <td className="td">{p.supplierName || '—'}{p.invoiceNumber && <div className="text-xs text-slate-500">NF {p.invoiceNumber}</div>}</td>
                <td className="td">{p.items.map((i: any) => i.productName).join(', ')}</td>
                <td className="td text-right font-semibold">{money(p.totalCents)}</td>
                <td className="td text-right">{money(p.paidCents)}</td>
                <td className="td">{p.status === 'cancelada' ? <Badge cls="bg-slate-200 text-slate-700">✖ Cancelada</Badge> : <Badge cls={PAY_STATUS[p.paymentStatus].cls}>{p.paymentStatus === 'pendente' ? 'A pagar' : PAY_STATUS[p.paymentStatus].label}</Badge>}</td>
                <td className="td text-right"><Button variant="ghost" className="p-1.5!" aria-label="Detalhes" onClick={() => setDetail(p.id)}><Eye className="h-4 w-4" /></Button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      {form && <PurchaseForm suppliers={sups} onClose={() => setForm(false)} onSaved={() => { setForm(false); load(); }} />}
      {detail && <PurchaseDetail id={detail} suppliers={sups} onClose={() => setDetail(null)} onChanged={load} />}
    </div>
  );
}

interface Src { code: string | null; description: string; unit: string; noteQty: string; factor: string; matchedBy: 'vinculo' | 'nome' | null; suggestedUnit: string }
interface Line { productId: string; qty: string; mode: 'unit' | 'total'; value: string; src?: Src; newName?: string; newUnit?: string; open?: boolean } // productId '__new' = produto novo

const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
/** Nome sugerido para produto novo: tira embalagem/quantidade da descrição da nota ("ARROZ TIPO 1 FD 6X5KG" -> "Arroz Tipo 1"). */
const cleanName = (desc: string) => {
  const t = desc
    .replace(/\b\d+\s*X\s*\d+([.,]\d+)?\s*(KG|G|GR|ML|L|LT|UN)?\b/gi, ' ')
    .replace(/\b\d+([.,]\d+)?\s*(KG|KGS|G|GR|GRS|ML|L|LT|LTS|UN|UND)\b/gi, ' ')
    .replace(/\bC\/\s*\d+\b/gi, ' ')
    .replace(/\b(FD|FARDO|CX|CXA|CAIXA|PCT|PACOTE|PC|PCS|SC|SACO)\s*\d*\b/gi, ' ')
    .replace(/\b(KG|KGS|G|GR|GRS|ML|L|LT|LTS|UN|UND)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  return titleCase(t || desc).slice(0, 80);
};
const fmtKey = (k: string) => k.replace(/(\d{4})(?=\d)/g, '$1 ');

function PurchaseForm({ suppliers, onClose, onSaved }: { suppliers: any[]; onClose: () => void; onSaved: () => void }) {
  const { today, settings } = useApp();
  const toast = useToast();
  const [products, setProducts] = useState<any[]>([]);
  const loadProducts = () => api('GET', '/products?active=1').then(setProducts).catch(() => {});
  useEffect(() => { loadProducts(); api('GET', '/purchases/photo-status').then((r) => setPhotoOn(r.enabled)).catch(() => {}); }, []);
  const key = useRef(crypto.randomUUID()); // mesma chave em reenvios => sem duplicar
  const [f, setF] = useState({ date: today, supplierId: '', invoice: '', discount: '0,00', freight: '0,00', method: '', payStatus: 'pago', paid: '', due: '', notes: '' });
  const [lines, setLines] = useState<Line[]>([{ productId: '', qty: '', mode: 'total', value: '' }]);
  const [accessKey, setAccessKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [newSupplier, setNewSupplier] = useState<{ name: string; cnpj: string | null } | null>(null);
  const [note, setNote] = useState<{ source: string; totalCents: number | null; warnings: string[]; duplicate: any } | null>(null);
  const [photoOn, setPhotoOn] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const act = useAction();
  const xmlRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const setLine = (i: number, p: Partial<Line>) => setLines((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setSrc = (i: number, p: Partial<Src>) => setLines((l) => l.map((x, j) => {
    if (j !== i || !x.src) return x;
    const src = { ...x.src, ...p };
    const nq = parseMilli(src.noteQty); const fac = parseMilli(src.factor);
    return { ...x, src, qty: nq && fac ? milliToInput(Math.round((nq * fac) / 1000)) : '' };
  }));

  /** Na linha simples, a pessoa só mexe na quantidade que entra; a conversão é recalculada para ser lembrada. */
  const setQtyCompact = (i: number, v: string) => setLines((l) => l.map((x, j) => {
    if (j !== i || !x.src) return x;
    const q = parseMilli(v); const nq = parseMilli(x.src.noteQty);
    return { ...x, qty: v, src: { ...x.src, factor: q && nq ? milliToInput(Math.round((q * 1000) / nq)) : x.src.factor } };
  }));

  // ---- chave de acesso (leitor de código de barras funciona como teclado e termina com Enter) ----
  const lastKey = useRef('');
  const checkKey = (raw: string) => act.run(async () => {
    const digits = raw.replace(/\D/g, '');
    if (digits === lastKey.current) return; // leitor envia a chave e um Enter: evita conferir duas vezes
    lastKey.current = digits;
    if (digits.length !== 44) { lastKey.current = ''; throw new Error('A chave de acesso tem 44 dígitos. Bipe o código de barras da nota ou digite a chave.'); }
    let r: any;
    try { r = await api('GET', `/purchases/check-key?key=${digits}`); } catch (e) { lastKey.current = ''; throw e; }
    setAccessKey(r.key); setKeyInput(fmtKey(r.key));
    setF((x) => ({ ...x, invoice: r.number, supplierId: r.supplier ? String(r.supplier.id) : x.supplierId }));
    if (!r.supplier) setNewSupplier((ns) => ns ?? null);
    setNote((n) => ({ source: n?.source ?? 'chave', totalCents: n?.totalCents ?? null, warnings: n?.warnings ?? [], duplicate: r.duplicate }));
    if (r.duplicate) toast.err(`Atenção: esta nota já foi lançada na compra #${r.duplicate.number}.`);
    else toast.ok(`Nota nº ${r.number} reconhecida${r.supplier ? ` — ${r.supplier.name}` : ''}.`);
  });

  const applyDraft = (d: any) => {
    setNote({ source: d.source, totalCents: d.totalCents, warnings: d.warnings ?? [], duplicate: d.duplicate });
    if (d.accessKey) { setAccessKey(d.accessKey); setKeyInput(fmtKey(d.accessKey)); }
    if (d.supplierMatch) { setF((x) => ({ ...x, supplierId: String(d.supplierMatch.id) })); setNewSupplier(null); }
    else if (d.supplier?.name) { setF((x) => ({ ...x, supplierId: '' })); setNewSupplier({ name: d.supplier.name, cnpj: d.supplier.cnpj }); }
    setF((x) => ({ ...x, date: d.issueDate ?? x.date, invoice: d.number ?? x.invoice, discount: centsToInput(d.discountCents ?? 0), freight: centsToInput((d.freightCents ?? 0) + (d.otherCents ?? 0)) }));
    setLines(d.items.map((it: any) => {
      const src: Src = { code: it.code, description: it.description, unit: it.unit, noteQty: milliToInput(Math.round(it.qty * 1000)), factor: milliToInput(it.factorMilli ?? 1000), matchedBy: it.matchedBy, suggestedUnit: it.suggestedUnit };
      const nq = Math.round(it.qty * 1000);
      const unit = settings!.units.includes(it.suggestedUnit) ? it.suggestedUnit : 'unidade';
      return {
        productId: it.productId ? String(it.productId) : '__new', newName: cleanName(it.description), newUnit: unit,
        mode: 'total' as const, value: centsToInput(it.totalCents), src, qty: nq ? milliToInput(Math.round((nq * (it.factorMilli ?? 1000)) / 1000)) : '',
      };
    }));
    if (d.duplicate) toast.err(`Atenção: esta nota já foi lançada na compra #${d.duplicate.number}.`);
    else {
      const novos = d.items.filter((it: any) => !it.productId).length;
      toast.ok(`${d.items.length} item(ns) lido(s)${novos ? `, ${novos} produto(s) novo(s) serão cadastrados` : ''}. Confira antes de confirmar.`);
    }
  };

  const onXml = async (file?: File) => {
    if (!file) return;
    setReading('Lendo o XML…');
    await act.run(async () => applyDraft(await api('POST', '/purchases/parse-xml', { xml: await readText(file) })));
    setReading(null); if (xmlRef.current) xmlRef.current.value = '';
  };
  const onPhoto = async (file?: File) => {
    if (!file) return;
    setReading('Lendo a foto da nota… pode levar alguns segundos.');
    await act.run(async () => { const img = await photoToBase64(file); applyDraft(await api('POST', '/purchases/parse-photo', { image: img.data, mediaType: img.mediaType })); });
    setReading(null); if (photoRef.current) photoRef.current.value = '';
  };

  const calc = useMemo(() => {
    let items = 0; const errs: string[] = [];
    const out = lines.map((l, i) => {
      const q = parseMilli(l.qty); const v = parseCents(l.value);
      if (!l.productId) errs.push(`Linha ${i + 1}: escolha o produto do estoque.`);
      if (l.productId === '__new' && !l.newName?.trim()) errs.push(`Linha ${i + 1}: informe o nome do produto novo.`);
      if (!q) errs.push(`Linha ${i + 1}: quantidade inválida.`);
      if (v === null || v < 0) errs.push(`Linha ${i + 1}: informe o valor.`);
      const total = q && v !== null ? (l.mode === 'total' ? v : Math.round((q * v) / 1000)) : 0;
      const unit = q && v !== null ? (l.mode === 'unit' ? v : Math.round((v * 1000) / q)) : 0;
      items += total;
      return { q, v, total, unit };
    });
    const disc = parseCents(f.discount || '0') ?? -1; const fr = parseCents(f.freight || '0') ?? -1;
    if (disc < 0) errs.push('Desconto inválido.');
    if (fr < 0) errs.push('Frete inválido.');
    const total = items + Math.max(fr, 0) - Math.max(disc, 0);
    if (total < 0) errs.push('O desconto deixa o total negativo.');
    const ids = lines.map((l) => (l.productId === '__new' ? `novo:${(l.newName ?? '').trim().toLowerCase()}` : l.productId)).filter(Boolean);
    if (new Set(ids).size !== ids.length) errs.push('O mesmo produto aparece duas vezes. Junte em uma linha.');
    return { out, items, disc, fr, total, errs };
  }, [lines, f.discount, f.freight]);

  const save = () => act.run(async () => {
    if (note?.duplicate) throw new Error(`Esta nota já foi lançada na compra #${note.duplicate.number}.`);
    if (calc.errs.length) throw new Error(calc.errs[0]);
    if (f.payStatus !== 'pendente' && !f.method) throw new Error('Escolha a forma de pagamento. É ela que diz se o dinheiro entra na gaveta do Caixa do dia.');
    let paidCents: number | undefined;
    if (f.payStatus === 'parcial') {
      const p = parseCents(f.paid);
      if (p === null || p <= 0 || p >= calc.total) throw new Error('Informe o valor pago (maior que zero e menor que o total).');
      paidCents = p;
    }
    const body = {
      idempotencyKey: key.current, purchaseDate: f.date, supplierId: f.supplierId ? Number(f.supplierId) : null, invoiceNumber: f.invoice,
      accessKey, newSupplier: !f.supplierId && newSupplier ? newSupplier : null,
      items: lines.map((l, i) => ({
        productId: l.productId === '__new' ? null : Number(l.productId),
        newProduct: l.productId === '__new' ? { name: l.newName!.trim(), unit: l.newUnit || 'unidade' } : null,
        qtyMilli: calc.out[i].q!, ...(l.mode === 'unit' ? { unitCostCents: calc.out[i].v } : { totalCents: calc.out[i].v }),
        source: l.src ? { code: l.src.code, description: l.src.description, unit: l.src.unit, factorMilli: parseMilli(l.src.factor) ?? 1000, remember: true } : null,
      })),
      discountCents: calc.disc, freightCents: calc.fr, paymentMethod: f.method || null, paymentStatus: f.payStatus, paidCents, dueDate: f.due || null, notes: f.notes,
    };
    const r = await api('POST', '/purchases', body);
    toast.ok(r.duplicate ? `Compra #${r.number} já havia sido registrada (nada foi duplicado).`
      : `Compra #${r.number} confirmada e estoque atualizado.${r.createdProducts?.length ? ` ${r.createdProducts.length} produto(s) novo(s) cadastrado(s).` : ''}`);
    onSaved();
  });

  const noteDiff = note?.totalCents != null ? calc.total - note.totalCents : 0;

  return (
    <Modal wide title="Nova compra" onClose={onClose} footer={<>
      <div className="mr-auto self-center text-sm">Total: <strong className="text-lg">{money(calc.total)}</strong>
        {note?.totalCents != null && <span className={`ml-2 text-xs ${Math.abs(noteDiff) > 1 ? 'font-semibold text-red-700' : 'text-green-700'}`}>{Math.abs(noteDiff) > 1 ? `≠ nota ${money(note.totalCents)}` : '✔ bate com a nota'}</span>}
      </div>
      <Button variant="secondary" onClick={onClose} disabled={act.busy}>Cancelar</Button>
      <Button loading={act.busy && !reading} disabled={!!reading || !!note?.duplicate} onClick={save}>Confirmar compra</Button>
    </>}>
      <ErrorBox message={act.error} />

      <section className="mb-4 rounded-xl border border-brand-100 bg-brand-50/60 p-3">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold"><ScanLine className="h-4 w-4" />Preencher pela nota fiscal</h3>
        <div className="grid gap-2 lg:grid-cols-[1fr_auto_auto]">
          <form onSubmit={(e) => { e.preventDefault(); checkKey(keyInput); }} className="flex gap-2">
            <label htmlFor="nf-key" className="sr-only">Chave de acesso</label>
            <input id="nf-key" className="input font-mono" autoFocus placeholder="Bipe o código de barras ou digite a chave (44 dígitos)" value={keyInput}
              onChange={(e) => { setKeyInput(e.target.value); if (e.target.value.replace(/\D/g, '').length === 44) checkKey(e.target.value); }} />
            <Button type="submit" variant="secondary" disabled={act.busy}>OK</Button>
          </form>
          <Button variant="secondary" disabled={!!reading} onClick={() => xmlRef.current?.click()}><FileCode2 className="h-4 w-4" />Importar XML</Button>
          <Button variant="secondary" disabled={!!reading} onClick={() => photoOn ? photoRef.current?.click() : act.setError('A leitura por foto ainda não está ativada. Para ativar, coloque sua chave ANTHROPIC_API_KEY no arquivo .env e reinicie o sistema (passo a passo no README). Enquanto isso, use o XML ou bipe a chave.')}>
            <Camera className="h-4 w-4" />Foto da nota
          </Button>
          <input ref={xmlRef} type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={(e) => onXml(e.target.files?.[0])} />
          <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
        </div>
        {reading && <p className="mt-2 flex items-center gap-2 text-sm text-brand-700"><Loader2 className="h-4 w-4 animate-spin" />{reading}</p>}
        {!note && !reading && <p className="mt-2 text-xs text-slate-600">O <strong>XML</strong> (enviado pelo fornecedor) traz todos os itens e valores exatos. A <strong>foto</strong> lê o papel com IA e precisa de conferência. Bipar a chave registra a nota e impede lançá-la duas vezes.</p>}
        {accessKey && <p className="mt-2 font-mono text-xs text-slate-700">Chave: {fmtKey(accessKey)}</p>}
        {note?.duplicate && <div role="alert" className="mt-2 rounded-lg bg-red-100 p-2 text-sm font-semibold text-red-800">Esta nota já foi lançada na compra #{note.duplicate.number}. Ela não pode entrar de novo no estoque.</div>}
        {note?.warnings?.length ? <ul className="mt-2 list-disc pl-5 text-sm text-amber-800">{note.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
      </section>

      {products.length === 0 && <div className="mb-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">Ainda não há produtos no estoque: os produtos desta compra serão <strong>cadastrados automaticamente</strong> ao confirmar.</div>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Data da compra"><input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Fornecedor"><select className="input" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
          <option value="">{newSupplier ? `Novo: ${newSupplier.name}` : 'Não informado'}</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Nota fiscal (opcional)"><input className="input" value={f.invoice} onChange={(e) => setF({ ...f, invoice: e.target.value })} /></Field>
      </div>
      {newSupplier && !f.supplierId && <p className="mt-1 text-xs text-slate-600">O fornecedor “{newSupplier.name}”{newSupplier.cnpj ? ` (CNPJ ${newSupplier.cnpj})` : ''} será cadastrado ao confirmar.</p>}

      <h3 className="mb-2 mt-4 text-sm font-bold">Produtos</h3>
      <div className="space-y-2">
        {lines.map((l, i) => {
          const isNew = l.productId === '__new';
          const p = isNew ? { unit: l.newUnit || 'unidade' } : products.find((x) => String(x.id) === l.productId);
          const c = calc.out[i];
          return (
            <div key={i} className="rounded-lg border border-slate-200 p-2">
              {l.src && !l.open && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="truncate">{isNew ? (l.newName || 'Produto novo') : (products.find((x) => String(x.id) === l.productId)?.name ?? 'Escolha o produto')}</strong>
                      {isNew && <Badge cls="bg-blue-100 text-blue-800">＋ novo — será cadastrado</Badge>}
                      {!isNew && l.productId && l.src.matchedBy === 'vinculo' && <Badge cls="bg-green-100 text-green-800">✔ reconhecido</Badge>}
                      {!isNew && l.productId && l.src.matchedBy === 'nome' && <Badge cls="bg-amber-100 text-amber-800">? confira</Badge>}
                      {!l.productId && <Badge cls="bg-red-100 text-red-800">! escolha o produto</Badge>}
                    </div>
                    <div className="truncate text-xs text-slate-500">Na nota: {l.src.noteQty} {l.src.unit} — {l.src.description}</div>
                  </div>
                  <label className="flex items-center gap-1 text-sm">
                    <span className="text-xs font-semibold text-slate-600">Entra</span>
                    <input aria-label={`Quantidade que entra no estoque (${p?.unit ?? ''})`} className="input w-24! text-right" inputMode="decimal" value={l.qty} onChange={(e) => setQtyCompact(i, e.target.value)} />
                    <span className="w-14 text-xs text-slate-600">{p?.unit ?? ''}</span>
                  </label>
                  <span className="w-24 text-right text-sm font-semibold">{money(c.total)}</span>
                  <button type="button" className="text-xs font-semibold text-brand-700 underline" onClick={() => setLine(i, { open: true })}>ajustar</button>
                  <button type="button" disabled={lines.length === 1} onClick={() => setLines((x) => x.filter((_, j) => j !== i))} className="rounded-sm p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-30" aria-label="Remover"><Trash2 className="h-4 w-4" /></button>
                </div>
              )}
              {(!l.src || l.open) && (<>
              {l.src && l.open && (
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-sm bg-slate-100 px-2 py-0.5 font-mono">Na nota: {l.src.noteQty} {l.src.unit} — {l.src.description}</span>
                  {l.productId && l.src.matchedBy === 'vinculo' && <Badge cls="bg-green-100 text-green-800">✔ reconhecido</Badge>}
                  {l.productId && l.src.matchedBy === 'nome' && <Badge cls="bg-amber-100 text-amber-800">? sugerido pelo nome — confira</Badge>}
                  {isNew && <Badge cls="bg-blue-100 text-blue-800">＋ produto novo — será cadastrado</Badge>}
                  {!l.productId && <Badge cls="bg-red-100 text-red-800">! escolha o produto</Badge>}
                </div>
              )}
              <div className="grid grid-cols-12 gap-2">
                <Field label="Produto do estoque" className="col-span-12 sm:col-span-4">
                  <select className="input" value={l.productId} onChange={(e) => setLine(i, {
                    productId: e.target.value, newName: l.newName ?? (l.src ? cleanName(l.src.description) : ''), newUnit: l.newUnit ?? settings!.units[0],
                    ...(l.src ? { src: { ...l.src, matchedBy: null } } : {}),
                  })}>
                    <option value="">Escolha…</option>
                    <option value="__new">➕ Produto novo (cadastrar)</option>
                    {products.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}
                  </select>
                </Field>
                {isNew && (<>
                  <Field label="Nome do produto novo" className="col-span-8 sm:col-span-8 sm:order-last"><input className="input" value={l.newName ?? ''} onChange={(e) => setLine(i, { newName: e.target.value })} /></Field>
                  <Field label="Unidade no estoque" className="col-span-4 sm:col-span-4 sm:order-last"><select className="input" value={l.newUnit ?? 'unidade'} onChange={(e) => setLine(i, { newUnit: e.target.value })}>{settings!.units.map((u) => <option key={u}>{u}</option>)}</select></Field>
                </>)}
                {l.src ? (<>
                  <Field label={`Qtd. na nota (${l.src.unit})`} className="col-span-4 sm:col-span-2"><input className="input" inputMode="decimal" value={l.src.noteQty} onChange={(e) => setSrc(i, { noteQty: e.target.value })} /></Field>
                  <Field label={`1 ${l.src.unit} = ? ${p?.unit ?? ''}`} className="col-span-4 sm:col-span-2" hint={c.q ? `Entra: ${qty(c.q)} ${p?.unit ?? ''}` : undefined}><input className="input" inputMode="decimal" value={l.src.factor} onChange={(e) => setSrc(i, { factor: e.target.value })} /></Field>
                </>) : (<>
                  <Field label={`Qtd.${p ? ` (${p.unit})` : ''}`} className="col-span-4 sm:col-span-2"><input className="input" inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></Field>
                  <Field label="Informar" className="col-span-4 sm:col-span-2"><select className="input" value={l.mode} onChange={(e) => setLine(i, { mode: e.target.value as any })}><option value="total">Valor total</option><option value="unit">Valor unit.</option></select></Field>
                </>)}
                <Field label={l.src ? 'Valor total (R$)' : 'Valor (R$)'} className="col-span-4 sm:col-span-2"><input className="input" inputMode="decimal" value={l.value} onChange={(e) => setLine(i, { value: e.target.value })} /></Field>
                <div className="col-span-10 self-end pb-2 text-xs text-slate-600 sm:col-span-1">{c.q ? <>{money(c.unit)}/{p?.unit ?? 'un'}</> : ''}</div>
                <div className="col-span-2 flex items-end justify-end sm:col-span-1"><button type="button" disabled={lines.length === 1} onClick={() => setLines((x) => x.filter((_, j) => j !== i))} className="rounded-sm p-2 text-red-600 hover:bg-red-50 disabled:opacity-30" aria-label="Remover"><Trash2 className="h-4 w-4" /></button></div>
              </div>
                {l.src && <button type="button" className="mt-1 text-xs font-semibold text-brand-700 underline" onClick={() => setLine(i, { open: false })}>fechar ajustes</button>}
              </>)}
            </div>
          );
        })}
        <Button variant="secondary" onClick={() => setLines((l) => [...l, products.length ? { productId: '', qty: '', mode: 'total', value: '' } : { productId: '__new', newName: '', newUnit: settings!.units[0], qty: '', mode: 'total', value: '' }])}><Plus className="h-4 w-4" />Adicionar produto</Button>
        {lines.some((l) => l.src) && <p className="text-xs text-slate-500">A conversão (“1 FD = 30 kg”) e o produto escolhido ficam guardados para as próximas notas deste fornecedor.</p>}
      </div>
      <h3 className="mb-2 mt-4 text-sm font-bold">Valores e pagamento</h3>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Desconto (R$)"><input className="input" inputMode="decimal" value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} /></Field>
        <Field label="Frete e outras despesas (R$)"><input className="input" inputMode="decimal" value={f.freight} onChange={(e) => setF({ ...f, freight: e.target.value })} /></Field>
        <Field label="Forma de pagamento"><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="">Não informada</option>{settings!.paymentMethods.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Pagamento"><select className="input" value={f.payStatus} onChange={(e) => setF({ ...f, payStatus: e.target.value })}><option value="pago">Pago</option><option value="parcial">Pago em parte</option><option value="pendente">A pagar</option></select></Field>
        {f.payStatus === 'parcial' && <Field label="Valor pago (R$)"><input className="input" inputMode="decimal" value={f.paid} onChange={(e) => setF({ ...f, paid: e.target.value })} /></Field>}
        {f.payStatus !== 'pago' && <Field label="Vencimento"><input type="date" className="input" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>}
        <Field label="Observações" className="sm:col-span-4"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
        <span>Produtos</span><strong>{money(calc.items)}</strong><span>+ Frete/outros − desconto</span><strong>{money(Math.max(calc.fr, 0) - Math.max(calc.disc, 0))}</strong>
      </div>
      <p className="mt-2 text-xs text-slate-500">Frete e desconto são rateados entre os produtos para calcular o custo real de cada um (custo médio ponderado).</p>
    </Modal>
  );
}

function PurchaseDetail({ id, suppliers, onClose, onChanged }: { id: number; suppliers: any[]; onClose: () => void; onChanged: () => void }) {
  const { settings } = useApp();
  const toast = useToast();
  const [p, setP] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [pay, setPay] = useState(false);
  const [edit, setEdit] = useState<any | null>(null);
  const act = useAction();
  useEffect(() => { api('GET', `/purchases/${id}`).then(setP).catch((e) => setErr(e.message)); }, [id]);
  if (!p) return <Modal title="Compra" onClose={onClose}>{err ? <ErrorBox message={err} /> : 'Carregando…'}</Modal>;
  return (
    <Modal wide title={`Compra #${p.number}`} onClose={onClose} footer={p.status === 'confirmada' ? <>
      <Button variant="danger" className="mr-auto" onClick={() => setCancel(true)}>Cancelar compra</Button>
      {p.openCents > 0 && <Button variant="secondary" onClick={() => setPay(true)}>Registrar pagamento</Button>}
      <Button variant="secondary" onClick={() => setEdit({ supplierId: p.supplierId ? String(p.supplierId) : '', invoiceNumber: p.invoiceNumber ?? '', paymentMethod: p.paymentMethod ?? '', dueDate: p.dueDate ?? '', notes: p.notes ?? '' })}>Editar informações</Button>
    </> : undefined}>
      <ErrorBox message={act.error} />
      {p.status === 'cancelada' && <div className="mb-3 rounded-lg bg-slate-100 p-3 text-sm">Compra cancelada. Motivo: <strong>{p.cancelReason}</strong>. O estoque e os pagamentos foram estornados e constam no histórico.</div>}
      {edit ? (
        <div className="mb-3 grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
          <Field label="Fornecedor"><select className="input" value={edit.supplierId} onChange={(e) => setEdit({ ...edit, supplierId: e.target.value })}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Nota fiscal"><input className="input" value={edit.invoiceNumber} onChange={(e) => setEdit({ ...edit, invoiceNumber: e.target.value })} /></Field>
          <Field label="Forma de pagamento"><select className="input" value={edit.paymentMethod} onChange={(e) => setEdit({ ...edit, paymentMethod: e.target.value })}><option value="">—</option>{settings!.paymentMethods.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Vencimento"><input type="date" className="input" value={edit.dueDate} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })} /></Field>
          <Field label="Observações" className="sm:col-span-2"><input className="input" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          <p className="text-xs text-slate-500 sm:col-span-2">Produtos, quantidades e valores não podem ser editados (já movimentaram o estoque). Para corrigir, cancele a compra e registre de novo.</p>
          <div className="flex gap-2 sm:col-span-2"><Button loading={act.busy} onClick={() => act.run(async () => { setP(await api('PUT', `/purchases/${p.id}`, { ...edit, supplierId: edit.supplierId ? Number(edit.supplierId) : null })); setEdit(null); onChanged(); toast.ok('Compra atualizada.'); })}>Salvar</Button><Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button></div>
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-slate-500">Data</dt><dd>{dateBR(p.purchaseDate)}</dd></div>
          <div><dt className="text-xs text-slate-500">Fornecedor</dt><dd>{p.supplierName || '—'}</dd></div>
          <div><dt className="text-xs text-slate-500">Nota fiscal</dt><dd>{p.invoiceNumber || '—'}</dd></div>
          <div><dt className="text-xs text-slate-500">Vencimento</dt><dd>{dateBR(p.dueDate)}</dd></div>
          {p.accessKey && <div className="col-span-2 sm:col-span-4"><dt className="text-xs text-slate-500">Chave de acesso</dt><dd className="break-all font-mono text-xs">{fmtKey(p.accessKey)}</dd></div>}
          {p.notes && <div className="col-span-2 sm:col-span-4"><dt className="text-xs text-slate-500">Observações</dt><dd>{p.notes}</dd></div>}
        </dl>
      )}
      <table className="mt-3 w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Produto</th><th className="th text-right">Qtd.</th><th className="th text-right">Unit.</th><th className="th text-right">Total</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{p.items.map((i: any) => <tr key={i.id}><td className="td">{i.productName}</td><td className="td text-right">{qty(i.qtyMilli)} {i.unit}</td><td className="td text-right">{money(i.unitCostCents)}</td><td className="td text-right">{money(i.totalCents)}</td></tr>)}</tbody></table>
      <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
        <span>Produtos</span><strong>{money(p.itemsTotalCents)}</strong><span>Frete</span><strong>{money(p.freightCents)}</strong>
        <span>Desconto</span><strong>{money(p.discountCents)}</strong><span>Total</span><strong>{money(p.totalCents)}</strong>
        <span>Pago</span><strong className="text-green-700">{money(p.paidCents)}</strong><span>A pagar</span><strong className="text-amber-700">{money(p.openCents)}</strong>
      </div>
      <h3 className="mt-3 text-sm font-bold">Pagamentos</h3>
      {p.payments.length === 0 ? <p className="text-sm text-slate-500">Nenhum pagamento registrado.</p> : <ul className="divide-y divide-slate-100 text-sm">{p.payments.map((x: any) => <li key={x.id} className="flex justify-between py-1.5"><span>{dateBR(x.paidDate)} · {x.method || '—'} {x.notes && <span className="text-xs text-slate-500">({x.notes})</span>}</span><strong className={x.amountCents < 0 ? 'text-red-700' : ''}>{money(x.amountCents)}</strong></li>)}</ul>}
      {cancel && <Confirm danger title={`Cancelar compra #${p.number}?`} confirmLabel="Cancelar compra" onClose={() => setCancel(false)}
        message="As quantidades serão retiradas do estoque (movimentação de estorno) e os pagamentos estornados. A compra continua no histórico."
        onConfirm={async () => {
          if (!reason.trim()) { toast.err('Informe o motivo do cancelamento.'); return; }
          try { setP(await api('POST', `/purchases/${p.id}/cancel`, { reason })); setCancel(false); onChanged(); toast.ok('Compra cancelada e efeitos revertidos.'); }
          catch (e: any) { toast.err(e.message); }
        }}>
        <Field label="Motivo" className="mt-3"><input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Confirm>}
      {pay && <PaymentModal title="Registrar pagamento" max={p.openCents} methods={settings!.paymentMethods} defaultMethod={p.paymentMethod} onClose={() => setPay(false)}
        onSubmit={async (b) => { setP(await api('POST', `/purchases/${p.id}/payments`, b)); setPay(false); onChanged(); toast.ok('Pagamento registrado.'); }} />}
    </Modal>
  );
}
