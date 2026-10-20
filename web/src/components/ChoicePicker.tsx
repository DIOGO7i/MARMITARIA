// Pedido: a atendente monta a marmita tocando nos botões das carnes e guarnições do dia,
// até o limite da opção (ex.: Opção 2 = 1 carne + 2 guarnições). Guarnição pode repetir (2x Purê).
import type { DayItem } from '../lib/whatsapp';

export interface Choices { carnes: string[]; guarnicoes: string[] }
export const NO_CHOICES: Choices = { carnes: [], guarnicoes: [] };

/**
 * Toque num botão:
 *  - limite 1: escolhe esse (troca o anterior); tocar no escolhido tira.
 *  - repete (guarnição): soma mais um enquanto couber; cheio → tocar num escolhido tira ele; tocar num novo troca o último.
 *  - não repete (carne): liga/desliga; cheio → tocar num novo troca o último.
 */
export function pick(list: string[], name: string, max: number, repeat: boolean): string[] {
  const has = list.includes(name);
  if (max <= 0) return list;
  if (max === 1) return has ? [] : [name];
  if (!repeat) {
    if (has) return list.filter((x) => x !== name);
    return list.length < max ? [...list, name] : [...list.slice(0, -1), name];
  }
  if (list.length < max) return [...list, name];
  if (has) return list.filter((x) => x !== name);
  return [...list.slice(0, -1), name];
}

function Row({ label, items, chosen, max, repeat, onChange, index, kind }: {
  label: string; items: DayItem[]; chosen: string[]; max: number; repeat: boolean; onChange: (l: string[]) => void; index: number; kind: string;
}) {
  if (max <= 0) return null;
  const visible = items.filter((x) => !x.soldOut || chosen.includes(x.name));
  // escolhidos que não estão mais no cardápio (pedido antigo sendo editado) continuam aparecendo
  const extra = [...new Set(chosen.filter((c) => !items.some((x) => x.name === c)))].map((name) => ({ name, soldOut: true }));
  const falta = max - chosen.length;
  return (
    <div role="group" aria-label={`${label} da marmita ${index + 1}`}>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-sm font-bold">{label}</span>
        <span className={`text-xs font-semibold ${falta > 0 ? 'text-amber-700' : 'text-brand-700'}`}>
          {chosen.length} de {max}{falta > 0 ? ` · falta ${falta}` : ' ✓'}
        </span>
      </div>
      {visible.length + extra.length === 0 ? <p className="text-xs text-amber-700">Nenhuma {kind} no cardápio de hoje.</p> : (
        <div className="flex flex-wrap gap-1.5">
          {[...visible, ...extra].map((it) => {
            const n = chosen.filter((x) => x === it.name).length;
            const on = n > 0;
            return (
              <button key={it.name} type="button" aria-pressed={on} onClick={() => onChange(pick(chosen, it.name, max, repeat))}
                className={`rounded-lg border-2 px-3 py-2 text-sm font-semibold ${on ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                {n > 1 ? `${n}x ` : on ? '✓ ' : ''}{it.name}{it.soldOut && !on ? ' (esgotou)' : ''}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ChoicePicker({ index, carnes, guarnicoes, day, value, onChange }: {
  index: number; carnes: number; guarnicoes: number; day: { carnes: DayItem[]; guarnicoes: DayItem[] }; value: Choices; onChange: (c: Choices) => void;
}) {
  if (carnes <= 0 && guarnicoes <= 0) return null;
  return (
    <div className="mb-2 space-y-2.5 rounded-lg bg-slate-50 p-2.5">
      <Row label="Carne" kind="carne" index={index} items={day.carnes} chosen={value.carnes} max={carnes} repeat={false} onChange={(l) => onChange({ ...value, carnes: l })} />
      <Row label={guarnicoes > 1 ? 'Guarnições' : 'Guarnição'} kind="guarnição" index={index} items={day.guarnicoes} chosen={value.guarnicoes} max={guarnicoes} repeat onChange={(l) => onChange({ ...value, guarnicoes: l })} />
    </div>
  );
}
