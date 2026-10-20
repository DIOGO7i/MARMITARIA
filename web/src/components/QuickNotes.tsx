// Botões embaixo de cada marmita do pedido.
//  - Trocas da opção escolhida (montadas no Cardápio): "Carne: [✓ Frango empanado] [Almôndegas] [Omelete]".
//    Tocar numa troca escreve "Trocar frango empanado por Almôndegas" na observação; tocar no original desfaz.
//  - Observações rápidas (se a responsável cadastrar em Configurações).
import { hasNote, partSwapText, partSwapTexts, toggleNote } from '../lib/notes';
import type { MenuPart } from '../lib/whatsapp';

function Chip({ on, label, onClick, original }: { on: boolean; label: string; onClick: () => void; original?: boolean }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-semibold ${on ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
      {on ? '✓ ' : ''}{label}{original && !on ? <span className="ml-1 font-normal text-slate-400">(original)</span> : null}
    </button>
  );
}

export function QuickNotes({ value, onChange, parts, quick, index }: { value: string; onChange: (v: string) => void; parts: MenuPart[]; quick: string[]; index: number }) {
  const swappable = parts.filter((p) => p.value.trim() && p.swaps.length);
  const q = quick.filter((x) => x.trim());
  if (!swappable.length && !q.length) return null;
  return (
    <div className="mt-2 space-y-1.5" aria-label={`Trocas da marmita ${index + 1}`}>
      {swappable.map((p) => {
        const all = partSwapTexts(p);
        const chosen = p.swaps.find((a) => hasNote(value, partSwapText(p.value, a)));
        return (
          <div key={p.label + p.value} className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${p.label || p.value} da marmita ${index + 1}`}>
            {p.label && <span className="text-xs font-semibold text-slate-500">{p.label}:</span>}
            <Chip label={p.value} original on={!chosen} onClick={() => chosen && onChange(toggleNote(value, partSwapText(p.value, chosen), all))} />
            {p.swaps.map((a) => {
              const t = partSwapText(p.value, a);
              return <Chip key={a} label={a} on={chosen === a} onClick={() => onChange(toggleNote(value, t, all))} />;
            })}
          </div>
        );
      })}
      {q.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {q.map((x) => <Chip key={x} label={x} on={hasNote(value, x)} onClick={() => onChange(toggleNote(value, x))} />)}
        </div>
      )}
    </div>
  );
}
