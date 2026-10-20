// Converte a comanda (texto com comandos ESC/POS) nos bytes que a impressora térmica entende,
// e no formato que o app RawBT recebe: intent:base64,<bytes>#Intent;scheme=rawbt;...
// Acentos vão na tabela PC860 (português), escolhida com ESC t 3 no começo da comanda.

/** Tabela PC860 (bytes 0x80–0xA7). */
const CP860 = 'ÇüéâãàÁçêÊèÍÔìÃÂÉÀÈôõòÚùÌÕÜ¢£Ù₧ÓáíóúñÑªº';
const TO_BYTE = new Map<string, number>([...CP860].map((ch, i) => [ch, 0x80 + i]));
export const SELECT_CP860 = '\x1bt\x03';

/** Um caractere por byte (0–255), pronto para btoa. Letras que a tabela não tem perdem o acento; o resto vira "?". */
export function toPrinterBytes(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) { out += ch; continue; }
    if (c === 0xa0) { out += ' '; continue; } // espaço que não quebra
    const b = TO_BYTE.get(ch);
    if (b !== undefined) { out += String.fromCharCode(b); continue; }
    const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += /^[\x00-\x7f]+$/.test(plain) ? plain : '?';
  }
  return out;
}

/** Endereço que abre o RawBT e manda os bytes para a impressora. */
export function rawbtUrl(escpos: string): string {
  return `intent:base64,${btoa(toPrinterBytes(escpos))}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
}

/** O contrário (para conferir nos testes o que foi mandado). */
export function fromRawbtUrl(url: string): string {
  const m = url.match(/^intent:base64,([^#]*)#Intent;scheme=rawbt;package=ru\.a402d\.rawbtprinter;end;$/);
  if (!m) throw new Error('Endereço do RawBT inválido: ' + url.slice(0, 60));
  return [...atob(m[1])].map((ch) => { const c = ch.charCodeAt(0); return c >= 0x80 && c < 0x80 + CP860.length ? CP860[c - 0x80] : ch; }).join('');
}
