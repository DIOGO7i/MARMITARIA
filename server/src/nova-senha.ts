// Esqueceu a senha e o e-mail não está configurado? Quem instalou roda no servidor:
//   npm run nova-senha -- email@exemplo.com senha-nova
// A senha é trocada e todos os aparelhos conectados com esse usuário precisam entrar de novo.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit, openDb } from './db';
import { MIN_PASSWORD, setPassword } from './auth';

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < MIN_PASSWORD) {
  console.error(`Uso: npm run nova-senha -- email@exemplo.com senha-nova (mín. ${MIN_PASSWORD} caracteres)`);
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(here, '..', 'data');
const db = openDb(path.join(dataDir, 'marmitaria.db'));
const u = db.prepare('SELECT id, name FROM users WHERE email = ?').get(email) as { id: number; name: string } | undefined;
if (!u) {
  const list = (db.prepare('SELECT email FROM users ORDER BY id').all() as { email: string }[]).map((x) => x.email);
  console.error(`Nenhum usuário com o e-mail ${email}. Usuários cadastrados: ${list.join(', ') || 'nenhum'}.`);
  process.exit(1);
}
setPassword(db, u.id, password);
audit(db, 'usuario', u.id, 'senha_redefinida_pelo_suporte', null, null);
console.log(`Senha de ${u.name} (${email}) trocada. Já pode entrar com a senha nova.`);
