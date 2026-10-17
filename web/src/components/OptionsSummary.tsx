import { UtensilsCrossed } from 'lucide-react';

/** Quantas marmitas de cada opção do cardápio (e de cada tamanho) foram pedidas no período. */
export default function OptionsSummary({ data, total, title = 'Marmitas por opção' }: { data: { option: string; qty: number; sizes: { size: string; qty: number }[] }[]; total: number; title?: string }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 flex items-center gap-2 font-bold"><UtensilsCrossed className="h-4 w-4" />{title} <span className="text-sm font-normal text-slate-500">· {total} marmita(s), sem contar canceladas</span></h2>
      {data.length === 0 ? <p className="text-sm text-slate-500">Nenhuma marmita pedida no período.</p> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.map((o) => (
            <div key={o.option} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-baseline justify-between"><span className="font-semibold">{o.option}</span><span className="text-2xl font-bold text-brand-700">{o.qty}</span></div>
              <ul className="mt-1 space-y-0.5 text-sm text-slate-600">{o.sizes.map((s) => <li key={s.size} className="flex justify-between"><span>{s.size}</span><span>{s.qty}</span></li>)}</ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
