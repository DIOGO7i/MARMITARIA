// Telefones brasileiros: guardamos só os dígitos de DDD + número (10 ou 11 dígitos).
export class PhoneError extends Error { status = 400; }

const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/** Devolve o telefone normalizado ou lança erro com mensagem clara. Aceita "(11) 98888-7777", "+55 11 98888 7777" etc. */
export function normalizePhone(raw: unknown): string {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 8 || d.length === 9) throw new PhoneError('Informe o telefone com DDD. Ex.: (11) 98888-7777.');
  if (d.length !== 10 && d.length !== 11) throw new PhoneError('Telefone inválido. Use DDD + número, ex.: (11) 98888-7777.');
  if (!DDDS.has(Number(d.slice(0, 2)))) throw new PhoneError(`DDD ${d.slice(0, 2)} não existe. Confira o telefone.`);
  if (d.length === 11 && d[2] !== '9') throw new PhoneError('Celular com 11 dígitos deve começar com 9 depois do DDD.');
  return d;
}

export function tryNormalizePhone(raw: unknown): string | null {
  try { return normalizePhone(raw); } catch { return null; }
}

export function formatPhone(d: string): string {
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}
