import { NoteDraft, detectConversion } from '../nfe';
import { Ctx } from './common';

export const normText = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export const matchKeys = (code: string | null, description: string) => {
  const keys: string[] = [];
  if (code) keys.push(`cod:${code.trim()}`);
  keys.push(`desc:${normText(description)}`);
  return keys;
};

const STOP = new Set(['TIPO', 'T1', 'KG', 'UN', 'PCT', 'CX', 'FD', 'DE', 'DA', 'DO', 'COM', 'SEM', 'G', 'GR', 'ML', 'L', 'LT', 'X']);
const words = (s: string) => normText(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));

/** Sugere um produto do estoque pelo nome (palavras em comum). Só sugere com boa confiança. */
function guessByName(products: { id: number; name: string }[], description: string) {
  const dw = new Set(words(description));
  let best: { id: number; score: number } | null = null;
  for (const p of products) {
    const pw = words(p.name);
    if (!pw.length) continue;
    const hits = pw.filter((w) => dw.has(w) || [...dw].some((d) => d.startsWith(w) || w.startsWith(d))).length;
    const score = hits / pw.length;
    if (score >= 0.99 && (!best || score > best.score || (score === best.score && pw.length > words(products.find((x) => x.id === best!.id)!.name).length))) best = { id: p.id, score };
  }
  return best?.id ?? null;
}

/** Enriquece o rascunho da nota com: fornecedor encontrado, nota já lançada, sugestão de produto e fator por item. */
export function matchDraft(ctx: Ctx, d: NoteDraft) {
  const { db } = ctx;
  const supplier = d.supplier.cnpj
    ? (db.prepare('SELECT id, name FROM suppliers WHERE cnpj = ?').get(d.supplier.cnpj) as { id: number; name: string } | undefined) ?? null
    : null;
  const duplicate = d.accessKey
    ? (db.prepare("SELECT id, number FROM purchases WHERE access_key = ? AND status = 'confirmada'").get(d.accessKey) as { id: number; number: number } | undefined) ?? null
    : null;
  const products = db.prepare('SELECT id, name, unit FROM products WHERE active = 1').all() as { id: number; name: string; unit: string }[];
  const mapStmt = db.prepare('SELECT product_id, factor_milli FROM supplier_product_map WHERE supplier_cnpj = ? AND match_key = ?');
  const items = d.items.map((it) => {
    let productId: number | null = null; let factorMilli = 1000; let matchedBy: 'vinculo' | 'nome' | null = null;
    if (d.supplier.cnpj) {
      for (const k of matchKeys(it.code, it.description)) {
        const m = mapStmt.get(d.supplier.cnpj, k) as { product_id: number; factor_milli: number } | undefined;
        if (m && products.some((p) => p.id === m.product_id)) { productId = m.product_id; factorMilli = m.factor_milli; matchedBy = 'vinculo'; break; }
      }
    }
    const conv = detectConversion(it.description, it.unit);
    if (!productId) {
      productId = guessByName(products, it.description);
      if (productId) {
        matchedBy = 'nome';
        // só usa a conversão detectada se a unidade do produto existente for a mesma
        const pu = products.find((p) => p.id === productId)!.unit;
        if (pu === conv.unit) factorMilli = conv.factorMilli;
      } else {
        factorMilli = conv.factorMilli;
      }
    }
    return { ...it, productId, factorMilli, matchedBy, suggestedUnit: conv.unit, conversionDetected: conv.detected };
  });
  return { ...d, items, supplierMatch: supplier, duplicate };
}

export function saveMapping(ctx: Ctx, cnpj: string, code: string | null, description: string, noteUnit: string | null, productId: number, factorMilli: number) {
  const up = ctx.db.prepare(`INSERT INTO supplier_product_map(supplier_cnpj, match_key, description, note_unit, product_id, factor_milli)
    VALUES (?,?,?,?,?,?) ON CONFLICT(supplier_cnpj, match_key) DO UPDATE SET product_id=excluded.product_id, factor_milli=excluded.factor_milli,
    description=excluded.description, note_unit=excluded.note_unit, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  for (const k of matchKeys(code, description)) up.run(cnpj, k, description, noteUnit, productId, factorMilli);
}
