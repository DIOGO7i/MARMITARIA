// Como mostrar o que foi escolhido numa marmita: "2x Purê, Farofa".
export interface ItemChoices { carnes: string[]; guarnicoes: string[] }
export function countList(l: string[]) {
  const m = new Map<string, number>();
  for (const x of l) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].map(([n, q]) => (q > 1 ? `${q}x ${n}` : n));
}
/** Linhas da comanda: ["Carne: Bisteca", "Guarnições: 2x Purê"] (vazio = não escolheu) */
export function choiceLines(c: ItemChoices | null | undefined): string[] {
  if (!c) return [];
  const out: string[] = [];
  if (c.carnes.length) out.push(`${c.carnes.length > 1 ? 'Carnes' : 'Carne'}: ${countList(c.carnes).join(', ')}`);
  if (c.guarnicoes.length) out.push(`${c.guarnicoes.length > 1 ? 'Guarnições' : 'Guarnição'}: ${countList(c.guarnicoes).join(', ')}`);
  return out;
}
