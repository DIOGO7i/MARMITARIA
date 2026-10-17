import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { api, qs } from '../lib/api';
import { Field } from './ui';
import DistanceBadge from './DistanceBadge';

export interface AddressDraft { label: string; street: string; complement: string; neighborhood: string; reference: string }
export const emptyAddress = (label = 'Casa'): AddressDraft => ({ label, street: '', complement: '', neighborhood: '', reference: '' });
export const LABELS = ['Casa', 'Trabalho', 'Outro'];

interface Suggestion { id: string; main: string; secondary: string }
let placesOff = false; // sem a chave do mapa: o campo fica só para digitar

/**
 * Campos de endereço reutilizados no pedido e no cadastro do cliente.
 * Enquanto digita a rua, aparecem sugestões do mapa; ao tocar numa, a rua, o número e o bairro são preenchidos
 * sozinhos e a distância (com o frete) aparece logo abaixo. Não precisa cadastrar bairros.
 */
export default function AddressFields({ a, onChange, showLabel = true }: { a: AddressDraft; onChange: (a: AddressDraft) => void; showLabel?: boolean }) {
  const set = (k: keyof AddressDraft, v: string) => onChange({ ...a, [k]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-6">
      {showLabel && (
        <Field label="Nome do endereço" className="sm:col-span-2">
          <input className="input" list="address-labels" value={a.label} onChange={(e) => set('label', e.target.value)} placeholder="Casa, Trabalho…" />
        </Field>
      )}
      <datalist id="address-labels">{LABELS.map((l) => <option key={l} value={l} />)}</datalist>
      <div className={showLabel ? 'sm:col-span-4' : 'sm:col-span-6'}>
        <StreetSearch value={a.street} onType={(v) => set('street', v)}
          onPick={(street, neighborhood) => onChange({ ...a, street, neighborhood: neighborhood ?? a.neighborhood })} />
      </div>
      <div className="-mt-1 empty:hidden sm:col-span-6"><DistanceBadge street={a.street} neighborhood={a.neighborhood} /></div>
      <Field label="Complemento" className="sm:col-span-2"><input className="input" value={a.complement} onChange={(e) => set('complement', e.target.value)} placeholder="Apto, bloco, casa 2…" /></Field>
      <Field label="Bairro" className="sm:col-span-2" hint="Vem sozinho ao escolher o endereço sugerido.">
        <input className="input" value={a.neighborhood} onChange={(e) => set('neighborhood', e.target.value)} placeholder="Nome do bairro" />
      </Field>
      <Field label="Ponto de referência" className="sm:col-span-2"><input className="input" value={a.reference} onChange={(e) => set('reference', e.target.value)} placeholder="Perto da padaria…" /></Field>
    </div>
  );
}

/** Campo "Rua e número" com sugestões do mapa (lista abaixo do campo, funciona com toque e com o teclado). */
function StreetSearch({ value, onType, onPick }: { value: string; onType: (v: string) => void; onPick: (street: string, neighborhood: string | null) => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const session = useRef(crypto.randomUUID());
  const picked = useRef<string | null>(null); // texto que acabou de vir de uma sugestão: não busca de novo
  const [list, setList] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(-1);
  const [warn, setWarn] = useState<string | null>(null);

  useEffect(() => {
    const q = value.trim();
    if (placesOff || q.length < 4 || picked.current === value) { setList([]); setBusy(false); return; }
    let alive = true;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await api('GET', '/places/suggest' + qs({ q, session: session.current }));
        if (!r.enabled) placesOff = true;
        if (alive) { setList(r.suggestions ?? []); setActive(-1); setOpen(document.activeElement === input.current); }
      } catch { if (alive) setList([]); }
      finally { if (alive) setBusy(false); }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [value]);

  const pick = async (s: Suggestion) => {
    setOpen(false); setList([]);
    const fallback = s.main;
    try {
      const d = await api('GET', '/places/details' + qs({ id: s.id, session: session.current }));
      session.current = crypto.randomUUID(); // a sessão termina quando escolhe um endereço
      const street = d.found ? d.street : fallback;
      if (d.found && !d.number) {
        // achou a rua, mas sem número: deixa o cursor pronto para digitar o número
        const v = street.replace(/,\s*$/, '') + ', ';
        picked.current = v; onType(v); onPick(v, d.neighborhood ?? null);
        setWarn('Falta o número da casa: digite depois da vírgula.');
        requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(v.length, v.length); });
        return;
      }
      picked.current = street; setWarn(null);
      onPick(street, d.found ? d.neighborhood ?? null : null);
    } catch {
      picked.current = fallback; setWarn(null);
      onPick(fallback, null);
    }
  };

  const key = (e: React.KeyboardEvent) => {
    if (!open || list.length === 0) return;
    // Esc fecha só a lista de sugestões, não a janela do pedido
    if (e.key === 'Escape') { e.nativeEvent.stopPropagation(); setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % list.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? list.length - 1 : i - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(list[active]); }
  };

  const showList = open && list.length > 0;
  return (
    <div className="relative">
      <label htmlFor={id} className="label">Rua e número</label>
      <div className="relative">
        <input ref={input} id={id} className="input pr-9" value={value} autoComplete="off" placeholder="Comece a digitar: Rua Tibiriçá, 500"
          role="combobox" aria-expanded={showList} aria-controls={`${id}-list`} aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-o${active}` : undefined}
          onChange={(e) => { picked.current = null; setWarn(null); onType(e.target.value); }}
          onKeyDown={key} onFocus={() => list.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
        {busy && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" aria-hidden />}
      </div>
      {warn && <span className="mt-1 block text-xs font-semibold text-amber-700">{warn}</span>}
      {showList && (
        <ul id={`${id}-list`} role="listbox" aria-label="Endereços sugeridos"
          className="absolute inset-x-0 top-full z-40 mt-1 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {list.map((s, i) => (
            <li key={s.id} id={`${id}-o${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}
              className={`flex cursor-pointer items-start gap-2 px-3 py-2.5 text-sm ${i === active ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
              <span><span className="block font-semibold">{s.main}</span>{s.secondary && <span className="block text-xs text-slate-500">{s.secondary}</span>}</span>
            </li>
          ))}
          <li className="px-3 pb-1 pt-1.5 text-right text-[10px] text-slate-400" aria-hidden>Sugestões do Google</li>
        </ul>
      )}
    </div>
  );
}

export const addressLine = (a: { street: string; complement?: string | null; reference?: string | null }) =>
  [a.street, a.complement, a.reference ? `ref.: ${a.reference}` : null].filter(Boolean).join(' — ');
