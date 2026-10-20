// Formato que o RawBT entende: intent:base64,<bytes ESC/POS>#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;
// (texto direto o RawBT ignora e imprime só o aviso da versão grátis)
import { describe, it, expect } from 'vitest';

const ESC = new URL('../../web/src/lib/escpos.ts', import.meta.url).pathname;

describe('envio para o RawBT', () => {
  it('usa base64, no formato da documentação', async () => {
    const { rawbtUrl } = await import(ESC);
    const u = rawbtUrl('\x1b@Pedido #12\n');
    expect(u).toMatch(/^intent:base64,[A-Za-z0-9+/=]+#Intent;scheme=rawbt;package=ru\.a402d\.rawbtprinter;end;$/);
    const bytes = Buffer.from(u.slice('intent:base64,'.length, u.indexOf('#Intent')), 'base64');
    expect([...bytes.subarray(0, 2)]).toEqual([0x1b, 0x40]); // ESC @ chega intacto
    expect(bytes.toString('latin1')).toContain('Pedido #12\n'); // o "#" do número não quebra o endereço
  });
  it('acentos viram os bytes da tabela PC860 (português)', async () => {
    const { toPrinterBytes } = await import(ESC);
    const b = [...toPrinterBytes('ÇãâáàéêíóôõúÃÕÔÊÁÉÍÓÚ')].map((c) => c.charCodeAt(0));
    expect(b).toEqual([0x80, 0x84, 0x83, 0xa0, 0x85, 0x82, 0x88, 0xa1, 0xa2, 0x93, 0x94, 0xa3, 0x8e, 0x99, 0x8c, 0x89, 0x86, 0x90, 0x8b, 0x9f, 0x96]);
    expect(b.every((x) => x < 256)).toBe(true);
  });
  it('o que a tabela não tem perde o acento ou vira "?" (nunca quebra a impressão)', async () => {
    const { toPrinterBytes } = await import(ESC);
    expect(toPrinterBytes('ñ R$ 10,00 – ok ✓ ŕ')).toBe('\xa4 R$ 10,00 ? ok ? r');
  });
  it('ida e volta: "GUARNIÇÕES: 2x PURÊ" chega igual', async () => {
    const { rawbtUrl, fromRawbtUrl } = await import(ESC);
    const t = '\x1b@\x1bt\x03\x1d!\x01GUARNIÇÕES: 2x PURÊ\nCOBRAR R$ 28,00\n';
    expect(fromRawbtUrl(rawbtUrl(t))).toBe(t);
  });
});
