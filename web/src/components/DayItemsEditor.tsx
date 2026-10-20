// Cardápio do dia: lista de botões (carnes ou guarnições). Digita e adiciona; toca em "esgotou" no meio do movimento.
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { DayItem } from '../lib/whatsapp';
import { Button } from './ui';

export function DayItemsEditor({ title, hint, placeholder, items, onChange }: { title: string; hint: string; placeholder: string; items: DayItem[]; onChange: (l: DayItem[]) => void }) {
  const [v, setV] = useState('');
  const add = () => {
    // aceita vários de uma vez, separados por vírgula
    const novos = v.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
    const have = new Set(items.map((x) => x.name.toLowerCase()));
    const l = [...items];
    for (const n of novos) if (!have.has(n.toLowerCase())) { l.push({ name: n, soldOut: false }); have.add(n.toLowerCase()); }
    onChange(l); setV('');
  };
  return (
    <section className="card p-4">
      <h2 className="font-bold">{title}</h2>
      <p className="mb-3 text-sm text-slate-500">{hint}</p>
      <div className="flex gap-2">
        <input aria-label={`Adicionar em ${title}`} className="input min-w-0 flex-1" placeholder={placeholder} value={v}
          onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <Button variant="secondary" disabled={!v.trim()} onClick={add}><Plus className="h-4 w-4" />Adicionar</Button>
      </div>
      {items.length === 0 ? <p className="mt-3 text-sm text-amber-700">Nenhum ainda.</p> : (
        <ul className="mt-3 space-y-1.5" aria-label={title}>
          {items.map((it, i) => (
            <li key={it.name} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${it.soldOut ? 'border-red-200 bg-red-50' : 'border-slate-200'}`}>
              <span className={`flex-1 font-semibold ${it.soldOut ? 'text-slate-400 line-through' : ''}`}>{it.name}</span>
              <button type="button" aria-pressed={it.soldOut} aria-label={`${it.name} esgotou`} onClick={() => onChange(items.map((x, j) => (j === i ? { ...x, soldOut: !x.soldOut } : x)))}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${it.soldOut ? 'border-red-300 bg-red-600 text-white' : 'border-slate-300 text-slate-600'}`}>
                {it.soldOut ? 'Esgotou' : 'Tem'}
              </button>
              <Button variant="ghost" className="p-1.5!" aria-label={`Tirar ${it.name}`} onClick={() => onChange(items.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
