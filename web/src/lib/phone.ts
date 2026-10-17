// Mesmas regras do servidor (server/src/phone.ts), para avisar enquanto digita.
const DDDS = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99]);

export function checkPhone(raw: string): { digits: string | null; error: string | null; incomplete: boolean } {
  let d = raw.replace(/\D/g, '');
  if (!d) return { digits: null, error: null, incomplete: true };
  if (d.startsWith('00')) d = d.slice(2);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10) return { digits: null, error: d.length >= 8 && d.length <= 9 && !DDDS.has(Number(d.slice(0, 2))) ? 'Informe o telefone com DDD.' : null, incomplete: true };
  if (d.length > 11) return { digits: null, error: 'Telefone com dígitos demais.', incomplete: false };
  if (!DDDS.has(Number(d.slice(0, 2)))) return { digits: null, error: `DDD ${d.slice(0, 2)} não existe.`, incomplete: false };
  if (d.length === 11 && d[2] !== '9') return { digits: null, error: 'Celular deve começar com 9 depois do DDD.', incomplete: false };
  return { digits: d, error: null, incomplete: false };
}

export const formatPhone = (d: string) =>
  d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d;

/** Formata enquanto digita: (11) 98888-7777 */
export function maskPhone(raw: string) {
  const d = raw.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
