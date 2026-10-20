// Cardápio: montagem da marmita por partes (Acompanhamento, Carne, Guarnição…) e o que cada parte pode virar.
import { Plus, Trash2 } from 'lucide-react';
import { Button } from './ui';

export interface PartDraft { label: string; value: string; swapsText: string }

export function PartsEditor({ option, parts, onChange }: { option: string; parts: PartDraft[]; onChange: (p: PartDraft[]) => void }) {
  const set = (k: number, p: Partial<PartDraft>) => onChange(parts.map((x, j) => (j === k ? { ...x, ...p } : x)));
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-slate-700">Montagem da marmita</p>
      <p className="mb-2 text-xs text-slate-500">Em cada parte, escreva o que vai e, embaixo, pelo que o cliente pode trocar (separe por vírgula). No pedido, as trocas viram botões.</p>
      <div className="space-y-2">
        {parts.map((p, k) => {
          const name = p.label.trim() || p.value.trim() || `parte ${k + 1}`;
          return (
            <div key={k} className="space-y-1.5 rounded-lg border border-slate-200 p-2">
              <div className="flex items-center gap-2">
                <input aria-label={`Nome da parte ${k + 1} (${option})`} className="input min-w-0 flex-1 border-transparent! bg-slate-50 py-1! text-sm font-bold uppercase tracking-wide text-slate-600" maxLength={30} placeholder="Nome da parte (ex.: Carne)" value={p.label} onChange={(e) => set(k, { label: e.target.value })} />
                <Button variant="ghost" className="p-2!" aria-label={`Remover ${name} (${option})`} onClick={() => onChange(parts.filter((_, j) => j !== k))}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <input aria-label={`O que vai em ${name} (${option})`} className="input py-1.5!" maxLength={80} placeholder="O que vai (ex.: Frango empanado)" value={p.value} onChange={(e) => set(k, { value: e.target.value })} />
              <input aria-label={`Trocas de ${name} (${option})`} className="input py-1.5! text-sm" placeholder="Pode trocar por (ex.: Almôndegas, Omelete) — vazio se não troca" value={p.swapsText} onChange={(e) => set(k, { swapsText: e.target.value })} />
            </div>
          );
        })}
      </div>
      {parts.length < 8 && (
        <Button variant="secondary" className="mt-2 py-1.5! text-sm" onClick={() => onChange([...parts, { label: '', value: '', swapsText: '' }])}>
          <Plus className="h-4 w-4" />Adicionar parte
        </Button>
      )}
    </div>
  );
}
