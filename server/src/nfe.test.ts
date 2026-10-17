import { describe, it, expect, beforeEach } from 'vitest';
import { parseAccessKey, parseNfeXml, checkTotals, normalizePhotoResult, readNotePhoto, guessUnit } from './nfe';
import { openDb } from './db';
import { matchDraft } from './services/notes';
import { createProduct, getProduct } from './services/inventory';
import { createPurchase } from './services/purchases';
import type { Ctx } from './services/common';

export function withDv(k43: string) {
  let sum = 0; let w = 2;
  for (let i = 42; i >= 0; i--) { sum += Number(k43[i]) * w; w = w === 9 ? 2 : w + 1; }
  const r = sum % 11;
  return k43 + (r < 2 ? 0 : 11 - r);
}
const CNPJ = '12345678000195';
const KEY = withDv(`35261${0}${CNPJ}550010000012341123456789`.slice(0, 43).padEnd(43, '0'));

export const sampleXml = (key = KEY) => `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
 <NFe><infNFe Id="NFe${key}" versao="4.00">
  <ide><cUF>35</cUF><nNF>1234</nNF><serie>1</serie><dhEmi>2026-10-10T09:30:00-03:00</dhEmi></ide>
  <emit><CNPJ>${CNPJ}</CNPJ><xNome>ATACADO BOM PRECO LTDA</xNome></emit>
  <det nItem="1"><prod><cProd>7891</cProd><xProd>ARROZ TIPO 1 FD 6X5KG</xProd><uCom>FD</uCom><qCom>2.0000</qCom><vUnCom>150.0000000000</vUnCom><vProd>300.00</vProd><vDesc>10.00</vDesc></prod></det>
  <det nItem="2"><prod><cProd>555</cProd><xProd>FEIJAO CARIOCA 1KG</xProd><uCom>KG</uCom><qCom>10.0000</qCom><vUnCom>8.5000</vUnCom><vProd>85.00</vProd></prod></det>
  <det nItem="3"><prod><cProd>900</cProd><xProd>MARMITEX ALUMINIO N8 C/100</xProd><uCom>CX</uCom><qCom>1</qCom><vUnCom>62.40</vUnCom><vProd>62.40</vProd></prod></det>
  <total><ICMSTot><vProd>447.40</vProd><vFrete>15.00</vFrete><vSeg>0.00</vSeg><vDesc>10.00</vDesc><vIPI>0.00</vIPI><vST>0.00</vST><vOutro>0.00</vOutro><vNF>452.40</vNF></ICMSTot></total>
 </infNFe></NFe>
 <protNFe><infProt><chNFe>${key}</chNFe><cStat>100</cStat></infProt></protNFe>
</nfeProc>`;

describe('chave de acesso', () => {
  it('valida dígito verificador e extrai campos', () => {
    const k = parseAccessKey(KEY.replace(/(\d{4})/g, '$1 ')); // aceita com espaços (como impresso no DANFE)
    expect(k.key).toBe(KEY);
    expect(k.cnpj).toBe(CNPJ);
    expect(k.model).toBe('55');
  });
  it('recusa chave com dígito errado ou tamanho errado', () => {
    const bad = KEY.slice(0, 43) + ((Number(KEY[43]) + 1) % 10);
    expect(() => parseAccessKey(bad)).toThrow(/verificador/);
    expect(() => parseAccessKey('123')).toThrow(/44/);
  });
});

describe('XML da NF-e', () => {
  it('lê itens, quantidades, valores, frete, desconto e total', () => {
    const d = checkTotals(parseNfeXml(sampleXml()));
    expect(d.accessKey).toBe(KEY);
    expect(d.number).toBe('1234');
    expect(d.issueDate).toBe('2026-10-10');
    expect(d.supplier).toEqual({ cnpj: CNPJ, name: 'ATACADO BOM PRECO LTDA' });
    expect(d.items).toHaveLength(3);
    expect(d.items[0]).toMatchObject({ code: '7891', unit: 'FD', qty: 2, unitPriceCents: 15000, totalCents: 30000, discountCents: 1000 });
    expect(d.freightCents).toBe(1500);
    expect(d.discountCents).toBe(1000);
    expect(d.totalCents).toBe(45240);
    expect(d.warnings).toEqual([]);
  });
  it('avisa quando a soma não bate com o total', () => {
    const d = checkTotals(parseNfeXml(sampleXml().replace('<vNF>452.40</vNF>', '<vNF>999.00</vNF>')));
    expect(d.warnings.join(' ')).toMatch(/não bate/);
  });
  it('recusa arquivo que não é NF-e', () => {
    expect(() => parseNfeXml('<html><body>oi</body></html>')).toThrow(/não parece/);
  });
  it('item único (sem lista) também é lido', () => {
    const one = sampleXml().replace(/<det nItem="2">[\s\S]*?<\/det>\s*<det nItem="3">[\s\S]*?<\/det>/, '');
    expect(parseNfeXml(one).items).toHaveLength(1);
  });
  it('converte unidades conhecidas', () => {
    expect(guessUnit('KG')).toBe('kg');
    expect(guessUnit('CX')).toBe('caixa');
    expect(guessUnit('FD')).toBeNull();
  });
});

describe('foto da nota', () => {
  const fakeFetch = (payload: unknown, status = 200) => (async () => new Response(JSON.stringify(
    status === 200 ? { content: [{ type: 'text', text: 'Aqui está:\n' + JSON.stringify(payload) }] } : { error: { message: 'x' } }), { status })) as unknown as typeof fetch;

  it('sem chave configurada, avisa claramente (não finge que leu)', async () => {
    const old = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    await expect(readNotePhoto('a'.repeat(200), 'image/jpeg')).rejects.toThrow(/ANTHROPIC_API_KEY/);
    if (old) process.env.ANTHROPIC_API_KEY = old;
  });
  it('normaliza a resposta e sempre pede conferência', async () => {
    const d = await readNotePhoto('a'.repeat(200), 'image/jpeg', { apiKey: 'k', fetchImpl: fakeFetch({
      fornecedor_nome: 'Mercado X', fornecedor_cnpj: '12.345.678/0001-95', data_emissao: '2026-10-11', chave_acesso: '123',
      itens: [{ descricao: 'Tomate', unidade: 'kg', quantidade: 2.5, valor_unitario: 6, valor_total: 15 }], frete: 0, desconto_total: 0, valor_total: 15,
    }) });
    expect(d.source).toBe('foto');
    expect(d.supplier.cnpj).toBe(CNPJ);
    expect(d.items[0]).toMatchObject({ description: 'Tomate', qty: 2.5, totalCents: 1500, unit: 'KG' });
    expect(d.accessKey).toBeNull(); // chave inválida é descartada
    expect(d.warnings.join(' ')).toMatch(/confira/i);
  });
  it('foto sem itens dá erro claro', () => {
    expect(() => normalizePhotoResult({ itens: [] })).toThrow(/Não consegui identificar/);
  });
  it('erro do serviço não vira falso sucesso', async () => {
    await expect(readNotePhoto('a'.repeat(200), 'image/jpeg', { apiKey: 'k', fetchImpl: fakeFetch(null, 401) })).rejects.toThrow(/inválida/);
  });
});

describe('importação ponta a ponta', () => {
  let ctx: Ctx;
  beforeEach(() => { ctx = { db: openDb(':memory:'), userId: null, role: 'owner' }; });

  it('sugere produtos pelo nome, lança compra com conversão e lembra o vínculo', () => {
    const arroz = createProduct(ctx, { name: 'Arroz', unit: 'kg', minQtyMilli: 0, unitCostCents: 0, active: true });
    const feijao = createProduct(ctx, { name: 'Feijão', unit: 'kg', minQtyMilli: 0, unitCostCents: 0, active: true });
    const d1 = matchDraft(ctx, checkTotals(parseNfeXml(sampleXml())));
    expect(d1.supplierMatch).toBeNull();
    expect(d1.items[0]).toMatchObject({ productId: arroz.id, matchedBy: 'nome' });
    expect(d1.items[1]).toMatchObject({ productId: feijao.id, matchedBy: 'nome' });
    expect(d1.items[2].productId).toBeNull(); // marmitex não cadastrado

    const embal = createProduct(ctx, { name: 'Embalagem N8', unit: 'unidade', minQtyMilli: 0, unitCostCents: 0, active: true });
    const c = createPurchase(ctx, {
      idempotencyKey: 'imp-1', purchaseDate: d1.issueDate!, accessKey: d1.accessKey, newSupplier: { name: d1.supplier.name!, cnpj: d1.supplier.cnpj },
      items: [
        { productId: arroz.id, qtyMilli: 60000, totalCents: 30000, source: { code: '7891', description: d1.items[0].description, unit: 'FD', factorMilli: 30000 } }, // 2 FD × 30 kg
        { productId: feijao.id, qtyMilli: 10000, totalCents: 8500, source: { code: '555', description: d1.items[1].description, unit: 'KG', factorMilli: 1000 } },
        { productId: embal.id, qtyMilli: 100000, totalCents: 6240, source: { code: '900', description: d1.items[2].description, unit: 'CX', factorMilli: 100000 } },
      ],
      discountCents: d1.discountCents, freightCents: d1.freightCents + d1.otherCents, paymentStatus: 'pendente',
    });
    expect(c.totalCents).toBe(45240); // bate com a nota
    expect(c.invoiceNumber).toBeNull();
    expect(c.accessKey).toBe(KEY);
    expect(getProduct(ctx, arroz.id).qtyMilli).toBe(60000);
    expect(getProduct(ctx, embal.id).qtyMilli).toBe(100000);

    // mesma nota de novo: recusada
    expect(() => createPurchase(ctx, { idempotencyKey: 'imp-2', purchaseDate: '2026-10-10', accessKey: KEY, items: [{ productId: arroz.id, qtyMilli: 1000, totalCents: 100 }], discountCents: 0, freightCents: 0, paymentStatus: 'pago' })).toThrow(/já foi lançada/);

    // próxima nota do mesmo fornecedor: reconhece tudo pelo vínculo, com o fator
    const KEY2 = withDv(KEY.slice(0, 34).replace(/.$/, '9') + '112345678'.slice(0, 9));
    const d2 = matchDraft(ctx, parseNfeXml(sampleXml(KEY2)));
    expect(d2.supplierMatch?.name).toBe('ATACADO BOM PRECO LTDA');
    expect(d2.duplicate).toBeNull();
    expect(d2.items.map((i) => [i.productId, i.factorMilli, i.matchedBy])).toEqual([[arroz.id, 30000, 'vinculo'], [feijao.id, 1000, 'vinculo'], [embal.id, 100000, 'vinculo']]);
  });
});

describe('primeira compra com estoque vazio', () => {
  it('cadastra os produtos novos junto com a compra e lembra para a próxima nota', () => {
    const ctx: Ctx = { db: openDb(':memory:'), userId: null, role: 'owner' };
    const d = matchDraft(ctx, parseNfeXml(sampleXml()));
    expect(d.items.every((i) => i.productId === null)).toBe(true);
    const c = createPurchase(ctx, {
      idempotencyKey: 'vazio-1', purchaseDate: '2026-10-10', accessKey: d.accessKey, newSupplier: { name: d.supplier.name!, cnpj: d.supplier.cnpj },
      items: d.items.map((it, i) => ({
        productId: null, newProduct: { name: ['Arroz', 'Feijão', 'Marmitex N8'][i], unit: ['kg', 'kg', 'unidade'][i] },
        qtyMilli: Math.round(it.qty * [30000, 1000, 100000][i]), totalCents: it.totalCents,
        source: { code: it.code, description: it.description, unit: it.unit, factorMilli: [30000, 1000, 100000][i] },
      })),
      discountCents: d.discountCents, freightCents: d.freightCents, paymentStatus: 'pago',
    });
    expect(c.createdProducts).toEqual(['Arroz', 'Feijão', 'Marmitex N8']);
    const rows = ctx.db.prepare('SELECT name, unit, qty_milli FROM products ORDER BY id').all();
    expect(rows).toEqual([{ name: 'Arroz', unit: 'kg', qty_milli: 60000 }, { name: 'Feijão', unit: 'kg', qty_milli: 10000 }, { name: 'Marmitex N8', unit: 'unidade', qty_milli: 100000 }]);
    const KEY2 = withDv(KEY.slice(0, 25) + '000009999' + '187654321');
    const d2 = matchDraft(ctx, parseNfeXml(sampleXml(KEY2)));
    expect(d2.items.map((i) => i.matchedBy)).toEqual(['vinculo', 'vinculo', 'vinculo']);
  });

  it('se a compra falhar, nenhum produto fica cadastrado pela metade', () => {
    const ctx: Ctx = { db: openDb(':memory:'), userId: null, role: 'owner' };
    expect(() => createPurchase(ctx, {
      idempotencyKey: 'falha-1', purchaseDate: '2026-10-10',
      items: [{ productId: null, newProduct: { name: 'Arroz', unit: 'kg' }, qtyMilli: 1000, totalCents: 100 }],
      discountCents: 99999, freightCents: 0, paymentStatus: 'pago', // desconto deixa total negativo
    })).toThrow(/negativo/);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM products').get()).toEqual({ n: 0 });
  });
});

import { detectConversion } from './nfe';
describe('conversão automática pela descrição', () => {
  const c = (d: string, u: string) => { const r = detectConversion(d, u); return `${r.factorMilli / 1000} ${r.unit}`; };
  it('entende peso, volume, fardo e caixa', () => {
    expect(c('ARROZ 10KG', 'UN')).toBe('10 kg');
    expect(c('ARROZ TIPO 1 FD 6X5KG', 'FD')).toBe('30 kg');
    expect(c('FEIJAO CARIOCA 1KG', 'KG')).toBe('1 kg');
    expect(c('CEBOLA', 'KG')).toBe('1 kg');
    expect(c('OLEO SOJA 900ML', 'UN')).toBe('0.9 litro');
    expect(c('OLEO SOJA 900ML CX 20', 'CX')).toBe('18 litro');
    expect(c('SAL REFINADO 500G', 'PCT')).toBe('0.5 kg');
    expect(c('REFRI LATA 12X350ML', 'FD')).toBe('12 unidade');
    expect(c('REFRIGERANTE COLA LATA 350ML FD 12', 'FD')).toBe('12 unidade');
    expect(c('AGUA MINERAL 500ML FD 12', 'FD')).toBe('12 unidade');
    expect(c('MILHO VERDE LATA 170G CX 24', 'CX')).toBe('24 unidade');
    expect(c('REFRIGERANTE 2L PET', 'UN')).toBe('1 unidade');
    expect(c('SUCO LARANJA 1L', 'UN')).toBe('1 litro');
    expect(c('OVOS BRANCOS CX C/30', 'CX')).toBe('30 unidade');
    expect(c('CALABRESA DEFUMADA 2,5KG', 'UN')).toBe('2.5 kg');
    expect(c('MARMITEX ALUMINIO N8 C/100', 'CX')).toBe('100 unidade');
    expect(c('GUARDANAPO', 'PCT')).toBe('1 pacote');
    expect(c('OVOS BRANCOS', 'DZ')).toBe('1 unidade');
  });
});
