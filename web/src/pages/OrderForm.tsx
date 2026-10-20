import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bike, CheckCircle2, ChevronDown, Home, Loader2, MapPin, Plus, Store, Trash2, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import { nowLocal, useApp } from '../lib/context';
import { centsToInput, money, parseCents, statusFlow, statusInfo } from '../lib/format';
import { Button, ErrorBox, Field, Modal, useAction, useToast } from '../components/ui';
import AddressFields, { AddressDraft, addressLine, emptyAddress } from '../components/AddressFields';
import DistanceBadge, { DistanceView, kmText, tierFor, useDistance } from '../components/DistanceBadge';
import { checkPhone, maskPhone } from '../lib/phone';
import { flushBluetoothQuiet } from '../lib/btprint';
import { QuickNotes } from '../components/QuickNotes';
import { stripSwaps } from '../lib/notes';
import { ruleText, type DayItems, type MenuPart } from '../lib/whatsapp';
import { ChoicePicker, type Choices } from '../components/ChoicePicker';

type Lookup = 'vazio' | 'incompleto' | 'invalido' | 'buscando' | 'encontrado' | 'novo' | 'erro';
type AddrChoice = 'novo' | 'pedido' | number;

interface MenuOpt { name: string; description: string; sizes: string[]; soldOut?: boolean; parts?: MenuPart[]; carnes?: number; guarnicoes?: number }
interface Item { option: string; size: string; qty: string; price: string; notes: string; choices: Choices }
const noChoices = (): Choices => ({ carnes: [], guarnicoes: [] });

export default function OrderForm({ order, initialPhone, onClose, onSaved }: { order?: any; initialPhone?: string; onClose: () => void; onSaved: (o: any) => void }) {
  const { settings, user } = useApp();
  const toast = useToast();
  const sizes = settings!.sizes;
  const priceOf = (size: string) => sizes.find((s) => s.name === size)?.priceCents ?? 0;
  // Opções do cardápio do dia (botões Opção 1 / Opção 2): cada uma pode limitar os tamanhos e pode estar esgotada
  const [dayMenu, setDayMenu] = useState<{ saved: boolean; options: MenuOpt[]; items?: DayItems } | null>(null);
  // cardápio montado por botões (carnes e guarnições do dia): a atendente escolhe cada uma no pedido
  const dayItems: DayItems = dayMenu?.items ?? { carnes: [], guarnicoes: [] };
  const byItems = !!dayMenu?.saved && (dayItems.carnes.length > 0 || dayItems.guarnicoes.length > 0);
  const base = settings!.marmitaBase ?? 'Arroz e feijão';
  const menuOpts: MenuOpt[] = (dayMenu?.options ?? (settings!.menuOptions ?? []).map((o) => ({ ...o, soldOut: false }))).filter((o) => o.name.trim());
  const originalOptions = new Set<string>((order?.items ?? []).map((i: any) => i.option).filter(Boolean));
  const sizesFor = (option: string) => {
    const allowed = menuOpts.find((o) => o.name === option)?.sizes ?? [];
    const l = sizes.filter((s) => allowed.includes(s.name));
    return l.length ? l : sizes;
  };
  function newItem(): Item {
    const base = menuOpts.length ? sizesFor(menuOpts[0].name)[0] : (sizes[1] ?? sizes[0]);
    return { option: '', size: base.name, qty: '1', price: centsToInput(base.priceCents), notes: '', choices: noChoices() };
  }
  const pickOption = (i: number, option: string) => { setError(null); doPick(i, option); };
  const doPick = (i: number, option: string) => setItems((l) => l.map((x, j) => {
    if (j !== i) return x;
    const allowed = sizesFor(option);
    // trocou de opção: as trocas da opção anterior não valem mais (o resto da observação fica)
    const notes = x.option && x.option !== option ? stripSwaps(x.notes, menuOpts.find((o) => o.name === x.option)?.parts ?? []) : x.notes;
    // a nova opção pode levar menos guarnições: corta o que passar do limite
    const o = menuOpts.find((m) => m.name === option);
    const choices = { carnes: x.choices.carnes.slice(0, o?.carnes ?? 1), guarnicoes: x.choices.guarnicoes.slice(0, o?.guarnicoes ?? 1) };
    if (allowed.some((s) => s.name === x.size)) return { ...x, option, notes, choices };
    return { ...x, option, notes, choices, size: allowed[0].name, price: centsToInput(allowed[0].priceCents) };
  }));
  const n = nowLocal(settings!.timezone);
  const key = useRef(crypto.randomUUID());
  const { busy, error, run, setError } = useAction();

  const [f, setF] = useState(() => ({
    orderDate: order?.orderDate ?? n.date,
    orderTime: order?.orderTime ?? n.time,
    source: order?.source ?? 'presencial',
    customerName: order?.customerName ?? '',
    customerPhone: order?.customerPhone ?? (initialPhone ? maskPhone(initialPhone) : ''),
    deliveryType: order?.deliveryType ?? 'retirada',
    address: order?.address ?? '',
    neighborhood: order?.neighborhood ?? '',
    deliveryFee: centsToInput(order?.deliveryFeeCents ?? 0),
    deliveryCost: centsToInput(order?.deliveryCostCents ?? 0),
    discount: centsToInput(order?.discountCents ?? 0),
    paymentMethod: order?.paymentMethod ?? '',
    paymentStatus: order ? (order.paymentStatus as string) : 'pendente',
    paid: '',
    status: order?.status ?? 'pendente',
    expectedAt: order?.expectedAt ?? '',
    deliveredAt: order?.deliveredAt ?? '',
    notes: order?.notes ?? '',
  }));
  const [items, setItems] = useState<Item[]>(() =>
    order?.items?.length
      ? order.items.map((i: any) => ({ option: i.option ?? '', size: i.size, qty: String(i.qty), price: centsToInput(i.unitPriceCents), notes: i.notes ?? '', choices: i.choices ?? noChoices() }))
      : [newItem()],
  );
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  // "Mais opções" fechado na correria; abre sozinho se o pedido já tem desconto ou observação geral
  const [more, setMore] = useState(() => !!order && ((order.discountCents ?? 0) > 0 || !!order.notes || order.status === 'entregue'));
  const [priceEdit, setPriceEdit] = useState<Set<number>>(() => new Set(order ? (order.items ?? []).map((it: any, i: number) => ({ it, i })).filter(({ it }: any) => it.unitPriceCents !== priceOf(it.size)).map(({ i }: any) => i) : []));
  useEffect(() => {
    let alive = true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.orderDate)) return;
    api('GET', `/menu/${f.orderDate}`).then((m) => { if (alive) setDayMenu(m); }).catch(() => { if (alive) setDayMenu(null); });
    return () => { alive = false; };
  }, [f.orderDate]);

  // ---------- Cliente: busca pelo telefone, endereços salvos, cadastro sem sair da tela ----------
  const [lookup, setLookup] = useState<Lookup>('vazio');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [customer, setCustomer] = useState<any>(null);
  const [saveCustomer, setSaveCustomer] = useState(true);
  const [addrChoice, setAddrChoice] = useState<AddrChoice>(order?.deliveryType === 'entrega' ? 'pedido' : 'novo');
  // Frete automático pela distância. Editando um pedido, mantém o frete gravado até trocar o endereço.
  const [feeAuto, setFeeAuto] = useState(!order);
  const [newAddr, setNewAddr] = useState<AddressDraft>(emptyAddress());
  const [saveAddr, setSaveAddr] = useState(true);
  const lookupSeq = useRef(0);
  const firstLoad = useRef(true);
  // Editando pedido: mantém endereço e frete gravados até a pessoa mexer no telefone ou escolher outro endereço.
  const keepOrderChoice = useRef(!!order);
  const customerMode = lookup === 'encontrado' || lookup === 'novo';

  /** Aplica o endereço escolhido ao pedido (o frete vem da distância, logo abaixo). */
  const choose = (c: AddrChoice, cust = customer, draft = newAddr) => {
    setAddrChoice(c);
    if (c !== 'pedido') { keepOrderChoice.current = false; setFeeAuto(true); }
    if (c === 'pedido') { setF((p) => ({ ...p, deliveryType: 'entrega', address: order?.address ?? '', neighborhood: order?.neighborhood ?? '' })); return; }
    const a = c === 'novo' ? { text: addressLine(draft), neighborhood: draft.neighborhood.trim() } : cust?.addresses?.find((x: any) => x.id === c);
    if (!a) return;
    setF((p) => ({ ...p, deliveryType: 'entrega', address: a.text, neighborhood: a.neighborhood ?? '' }));
  };

  /** Retirada ou entrega. Na retirada some tudo de endereço e frete; na entrega, sugere o endereço do cliente. */
  const setType = (t: 'retirada' | 'entrega', cust = customer) => {
    if (t === 'retirada') {
      keepOrderChoice.current = false;
      setF((p) => ({ ...p, deliveryType: 'retirada', address: '', neighborhood: '', deliveryFee: '0,00', deliveryCost: '0,00', status: p.status === 'saiu_para_entrega' ? 'pronto' : p.status }));
      return;
    }
    if (order?.deliveryType === 'entrega' && keepOrderChoice.current) { choose('pedido', cust); return; }
    const l = cust?.addresses ?? [];
    const pref: AddrChoice = cust?.lastAddressId && l.some((a: any) => a.id === cust.lastAddressId) ? cust.lastAddressId : l.length ? l[0].id : 'novo';
    choose(pref, cust);
  };

  const applyFound = (c: any) => {
    setCustomer(c); setLookup('encontrado');
    setF((p) => ({ ...p, customerName: c.name }));
    if (order && keepOrderChoice.current) {
      // editando: mantém o que o pedido já tinha
      if (order.deliveryType === 'retirada') { /* continua retirada */ }
      else if (order.customerAddressId && c.addresses.some((a: any) => a.id === order.customerAddressId)) setAddrChoice(order.customerAddressId);
      else setAddrChoice('pedido');
    } else {
      // pedido novo: sugere o endereço do último pedido (ou o único endereço salvo)
      // pedido novo: repete como foi o último pedido (retirada, ou entrega no mesmo endereço)
      if (c.lastDeliveryType === 'entrega') setType('entrega', c);
      else if (c.lastDeliveryType === 'retirada') setType('retirada', c);
      else if (f.deliveryType === 'entrega') setType('entrega', c);
    }
    firstLoad.current = false;
  };

  useEffect(() => {
    const chk = checkPhone(f.customerPhone);
    setLookupError(chk.error);
    if (!chk.digits) {
      setCustomer(null);
      setLookup(chk.error ? 'invalido' : chk.incomplete && f.customerPhone.replace(/\D/g, '') ? 'incompleto' : 'vazio');
      return;
    }
    if (customer && customer.phone === chk.digits) return;
    if (customer) {
      // trocou para outro telefone: não deixa o nome do cliente anterior ir para o novo cadastro
      const prevName = customer.name;
      setF((p) => (p.customerName === prevName ? { ...p, customerName: '' } : p));
      setCustomer(null);
    }
    const seq = ++lookupSeq.current;
    setLookup('buscando');
    const t = setTimeout(async () => {
      try {
        const r = await api('GET', `/customers/by-phone/${chk.digits}`);
        if (seq !== lookupSeq.current) return;
        if (r.customer) applyFound(r.customer);
        else {
          setCustomer(null); setLookup('novo');
          if (!(order && keepOrderChoice.current) && typeof addrChoice === 'number') choose('novo', null);
          firstLoad.current = false;
        }
      } catch (e: any) { if (seq === lookupSeq.current) { setLookup('erro'); setLookupError(e.message); } }
    }, 300);
    return () => clearTimeout(t);
  }, [f.customerPhone]); // eslint-disable-line react-hooks/exhaustive-deps

  // pedido existente vinculado a um cliente: carrega o cadastro
  useEffect(() => {
    if (order?.customerId) api('GET', `/customers/${order.customerId}`).then((c) => { lookupSeq.current++; applyFound(c); }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Endereço escolhido → distância → faixa de frete (Configurações → Taxa de entrega pela distância)
  const selAddr = f.deliveryType !== 'entrega' ? null
    : typeof addrChoice === 'number' ? customer?.addresses?.find((x: any) => x.id === addrChoice) ?? null
    : addrChoice === 'novo' ? { street: newAddr.street, neighborhood: newAddr.neighborhood }
    : order ? { street: String(order.address ?? '').split(' — ')[0], neighborhood: order.neighborhood } : null;
  const dist = useDistance(selAddr?.street ?? '', selAddr?.neighborhood);
  const tiers = settings!.deliveryTiers ?? [];
  const tier = dist.k === 'ok' ? tierFor(tiers, dist.meters) : null;
  useEffect(() => {
    if (!feeAuto || f.deliveryType !== 'entrega' || !tier) return;
    setF((p) => ({ ...p, deliveryFee: centsToInput(tier.feeCents), deliveryCost: centsToInput(tier.costCents) }));
  }, [feeAuto, f.deliveryType, tier?.upToMeters, tier?.feeCents, tier?.costCents]); // eslint-disable-line react-hooks/exhaustive-deps
  const setFee = (k: 'deliveryFee' | 'deliveryCost', v: string) => { setFeeAuto(false); set(k, v); };

  const calc = useMemo(() => {
    const errs: string[] = [];
    let subtotal = 0;
    items.forEach((it, i) => {
      if (!order && menuOpts.length && !it.option) errs.push(`Marmita ${i + 1}: escolha ${menuOpts.filter((o) => !o.soldOut).map((o) => o.name).join(' ou ') || 'uma opção (todas estão marcadas como esgotadas no cardápio do dia)'}.`);
      if (it.option && !originalOptions.has(it.option) && menuOpts.find((o) => o.name === it.option)?.soldOut) errs.push(`Marmita ${i + 1}: a ${it.option} esgotou. Escolha outra.`);
      const q = Number(it.qty);
      const p = parseCents(it.price);
      if (!Number.isInteger(q) || q <= 0) errs.push(`Linha ${i + 1}: quantidade inválida.`);
      if (p === null || p < 0) errs.push(`Linha ${i + 1}: valor unitário inválido.`);
      if (Number.isInteger(q) && q > 0 && p !== null && p >= 0) subtotal += q * p;
    });
    const fee = parseCents(f.deliveryFee || '0');
    const cost = parseCents(f.deliveryCost || '0');
    const disc = parseCents(f.discount || '0');
    if (fee === null || fee < 0) errs.push('Frete cobrado inválido.');
    if (cost === null || cost < 0) errs.push('Custo da entrega inválido.');
    if (disc === null || disc < 0) errs.push('Desconto inválido.');
    const total = subtotal + (fee ?? 0) - (disc ?? 0);
    if (total < 0) errs.push('O desconto deixa o total negativo.');
    return { subtotal, fee: fee ?? 0, cost: cost ?? 0, disc: disc ?? 0, total, errs };
  }, [items, f.deliveryFee, f.deliveryCost, f.discount]);

  const setItem = (i: number, patch: Partial<Item>) => setItems((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = () => run(async () => {
    if (calc.errs.length) { setError(calc.errs[0]); return; }
    if (lookup === 'invalido') { setError(lookupError ?? 'Telefone inválido.'); return; }
    if (lookup === 'buscando') { setError('Aguarde a busca do cliente terminar.'); return; }
    if (lookup === 'novo' && saveCustomer && !f.customerName.trim()) { setError('Informe o nome para cadastrar o cliente (ou desmarque “Cadastrar cliente”).'); return; }
    if (f.deliveryType === 'entrega' && addrChoice === 'novo' && !newAddr.street.trim()) { setError('Informe a rua e o número do endereço de entrega.'); return; }
    if (f.deliveryType === 'entrega' && customerMode && addrChoice === 'novo' && saveAddr && !newAddr.label.trim()) { setError('Dê um nome ao endereço (ex.: Casa, Trabalho).'); return; }
    if (f.deliveryType === 'entrega' && !f.address.trim()) { setError('Informe o endereço de entrega.'); return; }
    if (!order && f.paymentStatus !== 'pendente' && !f.paymentMethod) { setError('Escolha a forma de pagamento. É ela que diz se o dinheiro entra na gaveta do Caixa do dia.'); return; }
    let paidCents: number | undefined;
    if (!order && f.paymentStatus === 'parcial') {
      const p = parseCents(f.paid);
      if (p === null || p <= 0 || p >= calc.total) { setError('Informe o valor já pago (maior que zero e menor que o total).'); return; }
      paidCents = p;
    }
    const body: any = {
      orderDate: f.orderDate, orderTime: f.orderTime, source: f.source, customerName: f.customerName, customerPhone: f.customerPhone,
      deliveryType: f.deliveryType, address: f.address, neighborhood: f.deliveryType === 'entrega' ? (f.neighborhood.trim() || null) : null,
      customerId: lookup === 'encontrado' ? customer?.id ?? null : null,
      customerAddressId: f.deliveryType === 'entrega' && lookup === 'encontrado' && typeof addrChoice === 'number' ? addrChoice : null,
      saveCustomer: lookup === 'novo' && saveCustomer,
      saveAddress: f.deliveryType === 'entrega' && customerMode && addrChoice === 'novo' && saveAddr && (lookup === 'encontrado' || saveCustomer)
        ? { label: newAddr.label.trim() || 'Casa', street: newAddr.street, complement: newAddr.complement || null, neighborhood: newAddr.neighborhood.trim() || null, reference: newAddr.reference || null } : null,
      items: items.map((it) => ({ option: it.option || null, size: it.size, qty: Number(it.qty), unitPriceCents: parseCents(it.price)!, notes: it.notes,
        choices: it.option && (byItems || it.choices.carnes.length || it.choices.guarnicoes.length) ? it.choices : null })),
      deliveryFeeCents: calc.fee, deliveryCostCents: calc.cost, discountCents: calc.disc,
      paymentMethod: f.paymentMethod || null, paymentStatus: order ? order.paymentStatus : f.paymentStatus, paidCents,
      expectedAt: f.expectedAt || null, notes: f.notes,
    };
    if (order) {
      if (f.deliveredAt && f.deliveredAt !== order.deliveredAt) body.deliveredAt = f.deliveredAt;
      const saved = await api('PUT', `/orders/${order.id}`, body);
      toast.ok(`Pedido #${saved.number} atualizado.`);
      flushBluetoothQuiet(settings);
      onSaved(saved);
    } else {
      body.status = f.status;
      body.idempotencyKey = key.current;
      const saved = await api('POST', '/orders', body);
      toast.ok(saved.duplicate ? `Pedido #${saved.number} já estava salvo.` : `Pedido #${saved.number} registrado.${body.saveCustomer ? ' Cliente cadastrado.' : ''}`);
      flushBluetoothQuiet(settings);
      onSaved(saved);
    }
  });

  return (
    <Modal wide title={order ? `Editar pedido #${order.number}` : 'Novo pedido'} onClose={onClose} footer={<>
      <div className="mr-auto self-center text-sm">Total <strong className="block text-2xl leading-tight text-brand-700">{money(calc.total)}</strong></div>
      <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
      <Button onClick={save} loading={busy}>{order ? 'Salvar alterações' : 'Registrar pedido'}</Button>
    </>}>
      <ErrorBox message={error} />

      {/* 1. CLIENTE */}
      <Step n={1} title="Cliente" right={
        <div className="flex gap-1" role="group" aria-label="Origem do pedido">{(['presencial', 'whatsapp'] as const).map((s) => (
          <button key={s} type="button" onClick={() => set('source', s)} aria-pressed={f.source === s}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${f.source === s ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300 text-slate-600'}`}>{s === 'presencial' ? 'Balcão' : 'WhatsApp'}</button>
        ))}</div>} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Telefone" error={lookup === 'invalido' || lookup === 'erro' ? lookupError : null}
          hint={lookup === 'vazio' ? 'Com DDD. Acha o cliente sozinho. Pode deixar em branco.' : lookup === 'incompleto' ? 'Continue digitando (DDD + número).' : undefined}>
          <input className="input text-lg" inputMode="tel" autoFocus={!order} placeholder="(16) 99999-9999" value={f.customerPhone}
            onChange={(e) => { keepOrderChoice.current = false; set('customerPhone', maskPhone(e.target.value)); }} />
        </Field>
        <Field label={lookup === 'novo' && saveCustomer ? 'Nome do cliente' : 'Nome (opcional)'}>
          <input className="input text-lg" value={f.customerName} readOnly={lookup === 'encontrado'} onChange={(e) => set('customerName', e.target.value)} />
        </Field>
      </div>
      {lookup === 'buscando' && <p className="mt-2 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Buscando cliente…</p>}
      {lookup === 'encontrado' && customer && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-900">
          <CheckCircle2 className="h-4 w-4" /><strong>{customer.name}</strong>
          <span className="text-green-800">· {customer.orders} pedido(s){customer.lastOrderAt ? ` · último em ${customer.lastOrderAt.slice(8, 10)}/${customer.lastOrderAt.slice(5, 7)}` : ''}</span>
          <Link to={`/clientes/${customer.id}`} target="_blank" className="ml-auto text-xs font-semibold underline">ver perfil</Link>
        </div>
      )}
      {lookup === 'novo' && (
        <label className="mt-2 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <UserPlus className="h-4 w-4" /><span>Telefone novo.</span>
          <input type="checkbox" className="ml-auto" checked={saveCustomer} onChange={(e) => setSaveCustomer(e.target.checked)} /><strong>Cadastrar cliente</strong>
        </label>
      )}

      {/* 2. RETIRADA OU ENTREGA */}
      <Step n={2} title="Retirada ou entrega" />
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Retirada ou entrega">
        {([['retirada', 'Retirada no local', <Store key="r" className="h-5 w-5" />], ['entrega', 'Entrega', <Bike key="e" className="h-5 w-5" />]] as const).map(([t, label, icon]) => (
          <button key={t} type="button" role="radio" aria-checked={f.deliveryType === t} onClick={() => f.deliveryType !== t && setType(t)}
            className={`flex items-center justify-center gap-2 rounded-lg border-2 px-3 py-3 text-base font-bold transition-colors ${f.deliveryType === t ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
            {icon}{label}
          </button>
        ))}
      </div>

      {f.deliveryType === 'entrega' && (
        <div className="mt-3 space-y-3">
          {((customer?.addresses?.length ?? 0) > 0 || addrChoice === 'pedido') && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Endereço da entrega">
              {(customer?.addresses ?? []).map((a: any) => (
                <AddrCard key={a.id} active={addrChoice === a.id} onClick={() => choose(a.id)} icon={<Home className="h-4 w-4" />} title={a.label}
                  text={a.text} sub={a.neighborhood || undefined}
                  extra={<DistanceBadge compact street={a.street ?? ''} neighborhood={a.neighborhood} />} />
              ))}
              {order && order.deliveryType === 'entrega' && addrChoice === 'pedido' && (
                <AddrCard active onClick={() => choose('pedido')} icon={<MapPin className="h-4 w-4" />} title="Endereço usado neste pedido" text={order.address} sub={order.neighborhood ?? ''} />
              )}
              <AddrCard active={addrChoice === 'novo'} onClick={() => choose('novo')} icon={<Plus className="h-4 w-4" />} title="Outro endereço" text="Digitar um endereço novo" />
            </div>
          )}
          {addrChoice === 'novo' && (
            <div className="rounded-lg border border-slate-200 p-3">
              <AddressFields a={newAddr} onChange={(a) => { setNewAddr(a); choose('novo', customer, a); }} showLabel={customerMode && saveAddr && (lookup === 'encontrado' || saveCustomer)} />
              {customerMode && (lookup === 'encontrado' || saveCustomer) && (
                <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={saveAddr} onChange={(e) => setSaveAddr(e.target.checked)} />Salvar este endereço no cadastro do cliente</label>
              )}
            </div>
          )}
          {/* frete: vem sozinho da distância; dá para mudar aqui mesmo */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <DistanceView st={dist} />
            {dist.k === 'ok' && tiers.length > 0 && !tier && <span className="text-amber-700">Passa da maior faixa ({kmText(tiers[tiers.length - 1].upToMeters)}): informe o frete.</span>}
            {(dist.k === 'none' || dist.k === 'err' || dist.k === 'off' || (dist.k === 'ok' && tiers.length === 0)) && <span className="text-amber-700">Informe o frete.</span>}
            <label className="ml-auto flex items-center gap-2 font-semibold">Frete R$
              <input aria-label="Frete cobrado do cliente (R$)" className="input w-24! py-1.5! text-right" inputMode="decimal" value={f.deliveryFee} onChange={(e) => setFee('deliveryFee', e.target.value)} />
            </label>
          </div>
        </div>
      )}

      {/* 3. MARMITAS */}
      <Step n={3} title="Marmitas" />
      {dayMenu && !dayMenu.saved && !order && <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">O cardápio de hoje ainda não foi montado: os botões mostram o modelo padrão.</p>}
      <div className="space-y-3">
        {items.map((it, i) => {
          const q = Number(it.qty) || 0;
          const sz = sizesFor(it.option);
          return (
            <div key={i} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Marmita {i + 1}</span>
                {items.length > 1 && <button type="button" onClick={() => setItems((l) => l.filter((_, j) => j !== i))} className="flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50" aria-label={`Remover marmita ${i + 1}`}><Trash2 className="h-3.5 w-3.5" />Tirar</button>}
              </div>
              {menuOpts.length > 0 && (
                <div className="mb-2 grid gap-2" role="radiogroup" aria-label={`Opção da marmita ${i + 1}`} style={{ gridTemplateColumns: `repeat(${Math.min(menuOpts.length, 4)}, minmax(0, 1fr))` }}>
                  {menuOpts.map((o) => {
                    const on = it.option === o.name;
                    const off = !!o.soldOut && !on && !originalOptions.has(o.name);
                    return (
                      <button key={o.name} type="button" role="radio" aria-checked={on} disabled={off} onClick={() => pickOption(i, o.name)}
                        className={`rounded-lg border-2 px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 hover:bg-slate-50'}`}>
                        <span className="block text-base font-bold">{on ? '✔ ' : ''}{o.name}{o.soldOut && <span className="ml-2 rounded-sm bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">Esgotou</span>}</span>
                        {(byItems ? ruleText(o, base) : o.description) && <span className="line-clamp-2 block text-xs text-slate-600">{byItems ? ruleText(o, base) : o.description}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Tamanho da marmita ${i + 1}`}>
                  {sz.map((s) => {
                    const on = it.size === s.name;
                    return <button key={s.name} type="button" role="radio" aria-checked={on} onClick={() => setItem(i, { size: s.name, price: centsToInput(s.priceCents) })}
                      className={`rounded-lg border-2 px-3 py-2 text-sm font-bold ${on ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                      {s.name}<span className={`ml-1 text-xs font-medium ${on ? 'text-white/85' : 'text-slate-500'}`}>{money(s.priceCents)}</span>
                    </button>;
                  })}
                  {!sz.some((s) => s.name === it.size) && <span className="self-center rounded-lg border-2 border-brand-500 px-3 py-2 text-sm font-bold">{it.size}</span>}
                </div>
                <div className="ml-auto flex items-center rounded-lg border-2 border-slate-300" role="group" aria-label={`Quantidade da marmita ${i + 1}`}>
                  <button type="button" aria-label="Menos uma" disabled={q <= 1} onClick={() => setItem(i, { qty: String(Math.max(1, q - 1)) })} className="h-10 w-10 text-xl font-bold text-slate-700 disabled:opacity-30">−</button>
                  <input aria-label={`Quantas marmitas ${i + 1}`} className="h-10 w-10 border-x border-slate-200 bg-transparent text-center text-lg font-bold" inputMode="numeric" value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value.replace(/\D/g, '') })} />
                  <button type="button" aria-label="Mais uma" onClick={() => setItem(i, { qty: String(q + 1) })} className="h-10 w-10 text-xl font-bold text-slate-700">+</button>
                </div>
              </div>
              {byItems && it.option && (() => {
                const o = menuOpts.find((m) => m.name === it.option);
                return <div className="mt-2"><ChoicePicker index={i} carnes={o?.carnes ?? 1} guarnicoes={o?.guarnicoes ?? 1} day={dayItems} value={it.choices} onChange={(c) => setItem(i, { choices: c })} /></div>;
              })()}
              <QuickNotes index={i} value={it.notes} onChange={(v) => setItem(i, { notes: v })} parts={[]} quick={settings!.quickNotes ?? []} />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input aria-label={`Observação da marmita ${i + 1}`} className="input min-w-0 flex-1 basis-full py-1.5! text-sm sm:basis-auto" placeholder="Observação: sem salada, trocar o arroz…" value={it.notes} onChange={(e) => setItem(i, { notes: e.target.value })} />
                {priceEdit.has(i) ? (
                  <label className="flex items-center gap-1 text-sm">R$<input aria-label={`Preço da marmita ${i + 1}`} autoFocus className="input w-24! py-1.5! text-right" inputMode="decimal" value={it.price} onChange={(e) => setItem(i, { price: e.target.value })} /></label>
                ) : (
                  <button type="button" onClick={() => setPriceEdit((p) => new Set(p).add(i))} className="text-xs text-slate-500 underline">mudar preço</button>
                )}
                <span className="w-20 text-right text-sm font-semibold">{money(q * (parseCents(it.price) ?? 0))}</span>
              </div>
            </div>
          );
        })}
        <Button variant="secondary" type="button" className="w-full py-2.5!" onClick={() => setItems((l) => [...l, newItem()])}><Plus className="h-4 w-4" />Outra marmita (opção ou tamanho diferente)</Button>
      </div>

      {/* 4. PAGAMENTO */}
      <Step n={4} title="Pagamento" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Forma de pagamento">
        {settings!.paymentMethods.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={f.paymentMethod === m} onClick={() => set('paymentMethod', f.paymentMethod === m ? '' : m)}
            className={`rounded-lg border-2 px-3 py-2.5 text-sm font-bold ${f.paymentMethod === m ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>{m}</button>
        ))}
      </div>
      {!order ? (
        <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Já pagou?">
          {([['pago', 'Já pagou'], ['pendente', 'Paga depois']] as const).map(([k, t]) => (
            <button key={k} type="button" role="radio" aria-checked={f.paymentStatus === k || (k === 'pago' && f.paymentStatus === 'parcial')} onClick={() => set('paymentStatus', k)}
              className={`rounded-lg border-2 px-3 py-2.5 text-sm font-bold ${(f.paymentStatus === k || (k === 'pago' && f.paymentStatus === 'parcial')) ? (k === 'pago' ? 'border-green-600 bg-green-50 text-green-800' : 'border-amber-500 bg-amber-50 text-amber-900') : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
              {k === 'pago' ? '✔ ' : '⏳ '}{t}{k === 'pendente' && f.deliveryType === 'entrega' ? ' (na entrega)' : ''}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-600">Recebido até agora: <strong>{money(order.paidCents)}</strong>. Para registrar um pagamento, use os detalhes do pedido.</p>
      )}

      {/* MAIS OPÇÕES: o que raramente muda */}
      <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="mt-4 flex w-full items-center justify-between rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
        <span>Mais opções <span className="font-normal text-slate-500">· desconto, horário, observação geral{!order ? ', status' : ''}</span></span>
        <ChevronDown className={`h-4 w-4 transition-transform ${more ? 'rotate-180' : ''}`} />
      </button>
      {more && (
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Field label="Desconto (R$)"><input className="input" inputMode="decimal" value={f.discount} onChange={(e) => set('discount', e.target.value)} /></Field>
          <Field label={f.deliveryType === 'entrega' ? 'Previsão de entrega' : 'Previsão de retirada'} className="sm:col-span-2"><input type="datetime-local" className="input" value={f.expectedAt} onChange={(e) => set('expectedAt', e.target.value)} /></Field>
          {!order && <Field label="Status inicial">
            <select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>
              {statusFlow(f.deliveryType).map((st) => <option key={st} value={st}>{statusInfo(st, f.deliveryType).label}</option>)}
            </select>
          </Field>}
          <Field label="Data do pedido"><input type="date" className="input" value={f.orderDate} onChange={(e) => set('orderDate', e.target.value)} /></Field>
          <Field label="Horário"><input type="time" className="input" value={f.orderTime} onChange={(e) => set('orderTime', e.target.value)} /></Field>
          {!order && f.paymentStatus !== 'pendente' && (
            <Field label="Pagou só uma parte? (R$)" hint="Deixe vazio se pagou tudo.">
              <input className="input" inputMode="decimal" value={f.paid} onChange={(e) => { const v = e.target.value; setF((p) => ({ ...p, paid: v, paymentStatus: v.trim() ? 'parcial' : 'pago' })); }} />
            </Field>
          )}
          {f.deliveryType === 'entrega' && user?.role === 'owner' && (
            <Field label="Pago ao entregador (R$)" hint="Só você vê."><input className="input" inputMode="decimal" value={f.deliveryCost} onChange={(e) => setFee('deliveryCost', e.target.value)} /></Field>
          )}
          {order && order.status === 'entregue' && (
            <Field label={f.deliveryType === 'entrega' ? 'Horário real da entrega' : 'Horário em que retirou'} hint={user?.role === 'owner' ? 'Correção manual' : 'Só a responsável pode corrigir'} className="sm:col-span-2">
              <input type="datetime-local" className="input" disabled={user?.role !== 'owner'} value={f.deliveredAt} onChange={(e) => set('deliveredAt', e.target.value)} />
            </Field>
          )}
          <Field label="Observação geral do pedido" className="sm:col-span-4"><textarea className="input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
      )}

      {(calc.fee > 0 || calc.disc > 0) && (
        <p className="mt-3 text-right text-sm text-slate-600">Marmitas {money(calc.subtotal)}{calc.fee > 0 && <> + frete {money(calc.fee)}</>}{calc.disc > 0 && <> − desconto {money(calc.disc)}</>}</p>
      )}
      {calc.errs.length > 0 && <p className="mt-2 text-xs text-red-600">{calc.errs[0]}</p>}
    </Modal>
  );
}

function Step({ n, title, right }: { n: number; title: string; right?: React.ReactNode }) {
  return (
    <div className="mb-2 mt-5 flex items-center gap-2 first:mt-0">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white" aria-hidden>{n}</span>
      <h3 className="text-base font-bold">{title}</h3>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}

function AddrCard({ active, onClick, icon, title, text, sub, extra }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; text?: string; sub?: string; extra?: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={active} onClick={onClick}
      className={`flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left text-sm transition-colors ${active ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/30' : 'border-slate-300 hover:bg-slate-50'}`}>
      <span className={`flex items-center gap-2 font-semibold ${active ? 'text-brand-700' : ''}`}>{icon}{title}</span>
      {text && <span className="line-clamp-2 text-slate-700">{text}</span>}
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
      {extra}
    </button>
  );
}
