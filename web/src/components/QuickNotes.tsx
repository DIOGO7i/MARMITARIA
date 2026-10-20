// Botões embaixo de cada marmita: trocas do dia (do Cardápio) e observações rápidas (das Configurações).
// Tocar escreve na observação; tocar de novo apaga.
import { hasNote, swapText, toggleNote } from '../lib/notes';

export interface SwapGroup { title: string; items: string[] }

function Chip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-semibold ${on ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
      {label}
    </button>
  );
}

export function QuickNotes({ value, onChange, swaps, quick, index }: { value: string; onChange: (v: string) => void; swaps: SwapGroup[]; quick: string[]; index: number }) {
  const groups = swaps.filter((g) => g.items.some((x) => x.trim()));
  const q = quick.filter((x) => x.trim());
  if (!groups.length && !q.length) return null;
  return (
    <div className="mt-2 space-y-1.5" aria-label={`Trocas e observações rápidas da marmita ${index + 1}`}>
      {groups.map((g) => {
        const all = g.items.filter((x) => x.trim()).map((x) => swapText(g.title, x));
        return (
          <div key={g.title} className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500">{swapText(g.title, '').replace(/ por $/, '')}:</span>
            {g.items.filter((x) => x.trim()).map((x) => {
              const t = swapText(g.title, x);
              return <Chip key={x} label={x} on={hasNote(value, t)} onClick={() => onChange(toggleNote(value, t, all))} />;
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
