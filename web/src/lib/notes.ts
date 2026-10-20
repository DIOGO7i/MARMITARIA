// Observação de cada marmita montada por botões: "Trocar a carne por Almôndegas; Sem salada".
export const NOTE_SEP = '; ';

export const splitNotes = (s: string) => String(s ?? '').split(/\s*;\s*/).map((x) => x.trim()).filter(Boolean);

/** "Para trocar a carne" + "Almôndegas" → "Trocar a carne por Almôndegas". */
export function swapText(title: string, item: string) {
  const t = title.trim().replace(/^para\s+/i, '').replace(/:$/, '');
  const s = t ? `${t} por ${item.trim()}` : item.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Parte do cardápio "Frango empanado" trocada por "Almôndegas" → "Trocar frango empanado por Almôndegas". */
export function partSwapText(value: string, alt: string) {
  const v = value.trim();
  return `Trocar ${v.charAt(0).toLowerCase() + v.slice(1)} por ${alt.trim()}`;
}
type PartLike = { value: string; swaps: string[] };
/** Todas as frases de troca possíveis de uma parte (para saber qual está escolhida e tirar as outras). */
export const partSwapTexts = (p: PartLike) => p.swaps.map((a) => partSwapText(p.value, a));
/** Tira da observação as trocas destas partes (ex.: a marmita mudou de opção). */
export const stripSwaps = (notes: string, parts: PartLike[]) => {
  const all = parts.flatMap(partSwapTexts);
  return splitNotes(notes).filter((n) => !all.some((a) => same(a, n))).join(NOTE_SEP);
};

const same = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }) === 0;
export const hasNote = (notes: string, fragment: string) => splitNotes(notes).some((p) => same(p, fragment));

/**
 * Liga/desliga um pedaço da observação. `exclusive` = outros pedaços do mesmo grupo
 * (só pode uma troca de carne por marmita: escolher outra substitui a anterior).
 */
export function toggleNote(notes: string, fragment: string, exclusive: string[] = []) {
  const parts = splitNotes(notes);
  if (parts.some((p) => same(p, fragment))) return parts.filter((p) => !same(p, fragment)).join(NOTE_SEP);
  return [...parts.filter((p) => !exclusive.some((e) => same(e, p))), fragment].join(NOTE_SEP);
}
