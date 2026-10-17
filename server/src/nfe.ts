// Leitura de nota fiscal: chave de acesso (44 dígitos), XML de NF-e/NFC-e e resultado da leitura por foto.
import { XMLParser } from 'fast-xml-parser';
import { ValidationError } from './money';

export interface NoteItem {
  code: string | null;        // código do produto no fornecedor (cProd)
  description: string;        // descrição na nota (xProd)
  unit: string;               // unidade comercial na nota (uCom)
  qty: number;                // quantidade na nota (decimal)
  unitPriceCents: number;
  totalCents: number;         // valor bruto do item (vProd)
  discountCents: number;      // desconto do item (vDesc)
}
export interface NoteDraft {
  source: 'xml' | 'foto';
  accessKey: string | null;
  number: string | null;
  series: string | null;
  issueDate: string | null;   // AAAA-MM-DD
  supplier: { cnpj: string | null; name: string | null };
  items: NoteItem[];
  freightCents: number;       // frete
  otherCents: number;         // seguro + outras despesas + IPI + ST (somados ao custo)
  discountCents: number;      // desconto total da nota
  totalCents: number | null;  // valor total da nota (vNF)
  warnings: string[];
}

const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** Valida a chave de acesso (44 dígitos, dígito verificador módulo 11) e extrai os campos. */
export function parseAccessKey(raw: string) {
  const k = onlyDigits(raw);
  if (k.length !== 44) throw new ValidationError('A chave de acesso precisa ter 44 dígitos.');
  let sum = 0; let w = 2;
  for (let i = 42; i >= 0; i--) { sum += Number(k[i]) * w; w = w === 9 ? 2 : w + 1; }
  const r = sum % 11;
  const dv = r < 2 ? 0 : 11 - r;
  if (dv !== Number(k[43])) throw new ValidationError('Chave de acesso inválida (dígito verificador não confere). Bipe ou digite novamente.');
  return {
    key: k,
    uf: k.slice(0, 2),
    yearMonth: `20${k.slice(2, 4)}-${k.slice(4, 6)}`,
    cnpj: k.slice(6, 20),
    model: k.slice(20, 22),        // 55 = NF-e, 65 = NFC-e
    series: String(Number(k.slice(22, 25))),
    number: String(Number(k.slice(25, 34))),
  };
}

const toCents = (v: unknown) => {
  const n = Number(String(v ?? '0').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const arr = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function parseNfeXml(xml: string): NoteDraft {
  if (!xml || xml.length > 5_000_000) throw new ValidationError('Arquivo XML vazio ou grande demais.');
  // NF-e nunca usa DOCTYPE/ENTITY; recusar evita arquivos maliciosos que travam o servidor (expansão de entidades).
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ValidationError('Este XML tem uma estrutura que não é permitido importar. Use o XML original da nota fiscal.');
  let doc: any;
  try {
    doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true, parseTagValue: false, processEntities: true }).parse(xml);
  } catch {
    throw new ValidationError('Não foi possível ler o arquivo. Confira se é o XML da nota fiscal.');
  }
  const nfe = doc?.nfeProc?.NFe ?? doc?.NFe ?? doc?.procNFe?.NFe;
  const inf = nfe?.infNFe;
  if (!inf) throw new ValidationError('Este arquivo não parece ser o XML de uma NF-e/NFC-e.');
  const warnings: string[] = [];
  const idKey = onlyDigits(inf['@Id']);
  const protKey = onlyDigits(doc?.nfeProc?.protNFe?.infProt?.chNFe);
  let accessKey: string | null = (protKey || idKey) || null;
  if (accessKey) { try { accessKey = parseAccessKey(accessKey).key; } catch { warnings.push('A chave de acesso do XML não passou na validação.'); } }
  if (!doc?.nfeProc?.protNFe) warnings.push('O XML não traz o protocolo de autorização da Sefaz. Confira se a nota foi autorizada.');

  const ide = inf.ide ?? {};
  const emit = inf.emit ?? {};
  const tot = inf.total?.ICMSTot ?? {};
  const issue = String(ide.dhEmi ?? ide.dEmi ?? '').slice(0, 10);

  const items: NoteItem[] = arr<any>(inf.det).map((d) => {
    const p = d.prod ?? {};
    const qty = Number(String(p.qCom ?? '0').replace(',', '.'));
    return {
      code: p.cProd != null ? String(p.cProd) : null,
      description: String(p.xProd ?? '').trim(),
      unit: String(p.uCom ?? 'UN').trim().toUpperCase(),
      qty: Number.isFinite(qty) ? qty : 0,
      unitPriceCents: toCents(p.vUnCom),
      totalCents: toCents(p.vProd),
      discountCents: toCents(p.vDesc),
    };
  });
  if (!items.length) throw new ValidationError('A nota não tem itens.');

  const other = toCents(tot.vSeg) + toCents(tot.vOutro) + toCents(tot.vIPI) + toCents(tot.vST) + toCents(tot.vIPIDevol);
  return {
    source: 'xml', accessKey,
    number: ide.nNF != null ? String(ide.nNF) : null,
    series: ide.serie != null ? String(ide.serie) : null,
    issueDate: /^\d{4}-\d{2}-\d{2}$/.test(issue) ? issue : null,
    supplier: { cnpj: onlyDigits(emit.CNPJ ?? emit.CPF) || null, name: emit.xNome ? String(emit.xNome).trim() : (emit.xFant ? String(emit.xFant) : null) },
    items,
    freightCents: toCents(tot.vFrete),
    otherCents: other,
    discountCents: toCents(tot.vDesc) || items.reduce((a, i) => a + i.discountCents, 0),
    totalCents: tot.vNF != null ? toCents(tot.vNF) : null,
    warnings,
  };
}

/** Confere se itens + frete + outros − desconto bate com o total da nota. */
export function checkTotals(d: NoteDraft) {
  const items = d.items.reduce((a, i) => a + i.totalCents, 0);
  const computed = items + d.freightCents + d.otherCents - d.discountCents;
  if (d.totalCents != null && Math.abs(computed - d.totalCents) > 1) {
    d.warnings.push(`A soma dos itens (${(computed / 100).toFixed(2).replace('.', ',')}) não bate com o total da nota (${(d.totalCents / 100).toFixed(2).replace('.', ',')}). Confira os valores.`);
  }
  return d;
}

/** Normaliza o JSON devolvido pela leitura de foto (nunca confia cegamente). */
export function normalizePhotoResult(j: any): NoteDraft {
  const warnings: string[] = ['Lido a partir de foto: confira cada item, quantidade e valor antes de confirmar.'];
  let accessKey: string | null = null;
  if (j?.chave_acesso) { try { accessKey = parseAccessKey(String(j.chave_acesso)).key; } catch { warnings.push('A chave de acesso lida na foto não é válida; ela foi ignorada.'); } }
  const items: NoteItem[] = arr<any>(j?.itens).map((i) => {
    const qty = Number(i?.quantidade);
    const total = toCents(i?.valor_total);
    const unitP = toCents(i?.valor_unitario);
    return {
      code: i?.codigo ? String(i.codigo) : null,
      description: String(i?.descricao ?? '').trim() || 'Item sem descrição',
      unit: String(i?.unidade ?? 'UN').trim().toUpperCase() || 'UN',
      qty: Number.isFinite(qty) && qty > 0 ? qty : 0,
      unitPriceCents: unitP,
      totalCents: total || Math.round((Number.isFinite(qty) ? qty : 0) * unitP),
      discountCents: toCents(i?.desconto),
    };
  }).filter((i) => i.description);
  if (!items.length) throw new ValidationError('Não consegui identificar itens na foto. Tente uma foto mais nítida, reta e com boa luz.');
  if (items.some((i) => i.qty <= 0)) warnings.push('Alguns itens ficaram sem quantidade. Preencha antes de confirmar.');
  const date = String(j?.data_emissao ?? '');
  return checkTotals({
    source: 'foto', accessKey,
    number: j?.numero ? String(j.numero) : null, series: j?.serie ? String(j.serie) : null,
    issueDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    supplier: { cnpj: onlyDigits(j?.fornecedor_cnpj) || null, name: j?.fornecedor_nome ? String(j.fornecedor_nome) : null },
    items, freightCents: toCents(j?.frete), otherCents: toCents(j?.outras_despesas), discountCents: toCents(j?.desconto_total),
    totalCents: j?.valor_total != null ? toCents(j.valor_total) : null, warnings,
  });
}

const PHOTO_PROMPT = `Você está lendo a foto de uma nota fiscal brasileira (DANFE de NF-e, cupom NFC-e ou nota de compra) de um restaurante que compra mercadorias.
Extraia os dados e responda APENAS com um JSON válido, sem texto antes ou depois, neste formato:
{"fornecedor_nome": string|null, "fornecedor_cnpj": string|null, "numero": string|null, "serie": string|null,
 "data_emissao": "AAAA-MM-DD"|null, "chave_acesso": string|null,
 "itens": [{"codigo": string|null, "descricao": string, "unidade": string, "quantidade": number, "valor_unitario": number, "valor_total": number, "desconto": number}],
 "frete": number, "outras_despesas": number, "desconto_total": number, "valor_total": number|null}
Regras: valores em reais como número com ponto decimal (ex.: 12.5). Não invente: se algo estiver ilegível, use null (ou 0 para frete/desconto/outras).
Copie a descrição dos itens como está na nota. A chave de acesso tem 44 dígitos. Se a imagem não for uma nota fiscal, responda {"itens": []}.`;

export async function readNotePhoto(imageBase64: string, mediaType: string, opts: { apiKey?: string; model?: string; fetchImpl?: typeof fetch } = {}): Promise<NoteDraft> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error('A leitura por foto ainda não está ativada. É preciso configurar a chave ANTHROPIC_API_KEY no arquivo .env (veja o README).'), { status: 501 });
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mediaType)) throw new ValidationError('Formato de imagem não suportado. Use JPG ou PNG.');
  const f = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: opts.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5',
        max_tokens: 4096,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: PHOTO_PROMPT },
        ] }],
      }),
    });
  } catch {
    throw Object.assign(new Error('Sem conexão com o serviço de leitura de foto. Verifique a internet.'), { status: 502 });
  }
  const body: any = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = res.status === 401 ? 'A chave ANTHROPIC_API_KEY é inválida.' : (body?.error?.message ?? `Erro ${res.status} no serviço de leitura.`);
    throw Object.assign(new Error(`Não foi possível ler a foto: ${msg}`), { status: 502 });
  }
  const text: string = (body?.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
  const m = text.match(/\{[\s\S]*\}/);
  let j: any;
  try { j = JSON.parse(m ? m[0] : text); } catch { throw new ValidationError('A leitura da foto não retornou dados válidos. Tente outra foto.'); }
  return normalizePhotoResult(j);
}

/** Converte a unidade da nota para uma unidade do estoque, quando é óbvio. */
export function guessUnit(noteUnit: string): string | null {
  const u = noteUnit.toUpperCase().replace(/[^A-Z]/g, '');
  const map: Record<string, string> = { UN: 'unidade', UND: 'unidade', UNID: 'unidade', UNIDADE: 'unidade', PC: 'unidade', PCA: 'unidade', KG: 'kg', KGS: 'kg', G: 'g', GR: 'g', L: 'litro', LT: 'litro', LTS: 'litro', LITRO: 'litro', ML: 'ml', PCT: 'pacote', PT: 'pacote', PACOTE: 'pacote', CX: 'caixa', CXA: 'caixa', CAIXA: 'caixa' };
  return map[u] ?? null;
}

/**
 * Descobre, pela descrição e unidade da nota, em que unidade o produto deve ficar no estoque
 * e quanto entra por unidade da nota. Ex.:
 *  "ARROZ 10KG" (UN)        -> kg, 10      | "ARROZ FD 6X5KG" (FD) -> kg, 30
 *  "OLEO 900ML" (UN)        -> litro, 0,9  | "MARMITEX C/100" (CX) -> unidade, 100
 *  "CEBOLA" (KG)            -> kg, 1       | "SAL 500G" (PCT)      -> kg, 0,5
 */
export function detectConversion(description: string, noteUnit: string): { unit: string; factorMilli: number; detected: boolean } {
  const d = description.toUpperCase().replace(',', '.');
  const direct = guessUnit(noteUnit);
  if (direct === 'kg' || direct === 'g' || direct === 'litro' || direct === 'ml') {
    // a nota já vende por peso/volume: 1 para 1 (g e ml viram kg e litro)
    if (direct === 'g') return { unit: 'kg', factorMilli: 1, detected: true };
    if (direct === 'ml') return { unit: 'litro', factorMilli: 1, detected: true };
    return { unit: direct, factorMilli: 1000, detected: true };
  }
  const toBase = (n: number, u: string) => {
    if (/^(KG|KGS|K)$/.test(u)) return { unit: 'kg', milli: Math.round(n * 1000) };
    if (/^(G|GR|GRS|GRAMAS?)$/.test(u)) return { unit: 'kg', milli: Math.round(n) };
    if (/^(L|LT|LTS|LITROS?)$/.test(u)) return { unit: 'litro', milli: Math.round(n * 1000) };
    if (/^ML$/.test(u)) return { unit: 'litro', milli: Math.round(n) };
    return null;
  };
  // Latas, garrafas e bebidas em fardo/caixa: conta unidades (ex.: "REFRIGERANTE LATA 350ML FD 12" -> 12 latas por fardo)
  if (/\b(LATA|LATAS|LATINHA|GARRAFA|GARRAFINHA|PET|SACHE|SACHET)\b/.test(d) || /\b(REFRIGERANTE|REFRI|AGUA|CERVEJA|ENERGETICO)\b/.test(d)) {
    const packN = d.match(/\b(?:FD|CX|FARDO|CAIXA|PCT|PACOTE)\s*(?:C\/)?\s*(\d+)\b/) || d.match(/\bC\/\s*(\d+)\b/) || d.match(/(\d+)\s*X\s*\d+(?:\.\d+)?\s*(?:ML|L|LT|G|GR)\b/);
    if (packN && Number(packN[1]) > 1) return { unit: 'unidade', factorMilli: Number(packN[1]) * 1000, detected: true };
    if (['UN', 'UND', 'UNID', 'LT', 'LATA', 'GF', 'GARRAFA'].includes(noteUnit.toUpperCase().replace(/[^A-Z]/g, ''))) return { unit: 'unidade', factorMilli: 1000, detected: true };
  }
  // 6X5KG, 12 X 1L, 24X350ML
  const multi = d.match(/(\d+)\s*X\s*(\d+(?:\.\d+)?)\s*(KG|KGS|G|GR|GRS|L|LT|LTS|ML)\b/);
  if (multi) {
    const b = toBase(Number(multi[2]), multi[3]);
    if (b) return { unit: b.unit, factorMilli: Number(multi[1]) * b.milli, detected: true };
  }
  // 10KG, 5 KG, 900ML, 1,5L
  const single = d.match(/(\d+(?:\.\d+)?)\s*(KG|KGS|G|GR|GRS|L|LT|LTS|ML)\b/);
  if (single) {
    const b = toBase(Number(single[1]), single[2]);
    if (b && b.milli > 0) {
      // "FD 6 UN" / "CX 12" junto com peso: multiplica pela quantidade de unidades do fardo
      const pack = d.match(/\b(?:FD|CX|FARDO|CAIXA)\s*(?:C\/)?\s*(\d+)\b/) || d.match(/\bC\/\s*(\d+)\b/);
      const mult = pack && ['FD', 'CX', 'FARDO', 'CAIXA'].includes(noteUnit.toUpperCase().replace(/[^A-Z]/g, '')) ? Number(pack[1]) : 1;
      return { unit: b.unit, factorMilli: b.milli * mult, detected: true };
    }
  }
  // C/100, CX 50 UN, PCT C/ 10 -> unidades
  const count = d.match(/\bC\/\s*(\d+)\b/) || d.match(/\b(\d+)\s*(?:UN|UND|UNID|UNIDADES)\b/);
  if (count && Number(count[1]) > 1) return { unit: 'unidade', factorMilli: Number(count[1]) * 1000, detected: true };
  return { unit: direct ?? 'unidade', factorMilli: 1000, detected: false };
}
