// Senhas e recuperação por link no e-mail (quando SMTP estiver configurado). Sem e-mail, quem instalou cria uma senha nova pelo comando nova-senha.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import type { DB } from './db';

export const MIN_PASSWORD = 6;

// Senhas que robôs testam primeiro. Com senha curta permitida, essas ficam proibidas.
const COMMON = new Set(['123456', '1234567', '12345678', '123456789', '1234567890', '654321', '111111', '000000', '123123', '112233', '121212', '123321',
  '666666', '777777', '888888', '999999', '222222', '333333', '444444', '555555', 'abc123', 'abcdef', 'qwerty', 'qwerty123', 'asdfgh', 'senha', 'senha1',
  'senha123', 'senha12', 'mudar123', 'admin', 'admin1', 'admin123', 'password', 'password1', 'iloveyou', 'brasil', 'brasil123', 'marmita', 'marmitas',
  'marmitaria', 'marmita123', 'gisa123', 'gisa1234', 'flamengo', 'corinthians', 'palmeiras', 'saopaulo', 'santos', 'jesus', 'jesus123', 'deus123',
  'amor123', 'familia', 'teste', 'teste1', 'teste123', '102030', '147258', '159753', '010203', 'aaaaaa', 'a1b2c3']);

/** Recusa senhas óbvias (lista comum, tudo igual, sequência, ou o próprio e-mail/nome). */
export function checkStrength(pw: string, email?: string, name?: string) {
  const p = pw.toLowerCase();
  const bad = () => { throw Object.assign(new Error('Essa senha é fácil demais de adivinhar. Use outra (por exemplo, juntando uma palavra e números que só você sabe).'), { status: 400 }); };
  if (COMMON.has(p) || /^(.)\1+$/.test(p) || '01234567890'.includes(p) || '09876543210'.includes(p) || 'abcdefghijklmnopqrstuvwxyz'.includes(p)) bad();
  const user = String(email ?? '').toLowerCase().split('@')[0];
  if (user.length >= 4 && (p === user || p.includes(user))) bad();
  const first = String(name ?? '').toLowerCase().trim().split(/\s+/)[0];
  if (first && first.length >= 4 && (p === first || /^\D*\d{0,4}$/.test(p) && p.replace(/\d+$/, '') === first)) bad();
}

/** Troca a senha e invalida todas as sessões abertas desse usuário. */
export function setPassword(db: DB, userId: number, newPassword: string) {
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD) throw Object.assign(new Error(`A nova senha deve ter ao menos ${MIN_PASSWORD} caracteres.`), { status: 400 });
  checkStrength(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(bcrypt.hashSync(newPassword, 12), userId);
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export interface Mailer { send(to: string, subject: string, text: string, html: string): Promise<void> }

/** Usa SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM. Sem SMTP_HOST, o envio por e-mail fica desativado. */
export function mailerFromEnv(env = process.env): Mailer | null {
  if (!env.SMTP_HOST || !env.SMTP_FROM) return null;
  const port = Number(env.SMTP_PORT ?? 587);
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST, port, secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
  });
  return { send: async (to, subject, text, html) => { await transport.sendMail({ from: env.SMTP_FROM, to, subject, text, html }); } };
}

export function createResetToken(db: DB, userId: number, minutes = 60): string {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + minutes * 60_000).toISOString();
  db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(new Date().toISOString(), userId); // só o link mais recente vale
  db.prepare('INSERT INTO password_resets(user_id, token_hash, expires_at) VALUES (?,?,?)').run(userId, sha256(token), expires);
  return token;
}

/** Valida e consome o token (uso único). Devolve o id do usuário. */
export function consumeResetToken(db: DB, token: string): number {
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sha256(String(token ?? ''))) as any;
  if (!row || row.used_at || row.expires_at < new Date().toISOString()) {
    throw Object.assign(new Error('Este link de redefinição é inválido ou expirou. Peça um novo.'), { status: 400 });
  }
  db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  return row.user_id;
}
