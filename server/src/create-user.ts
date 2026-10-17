// Uso: npm run create-user -- "Nome" email@exemplo.com senha [owner|staff]
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db';
import { MIN_PASSWORD } from './auth';

const [name, email, password, roleArg] = process.argv.slice(2);
const role = roleArg === 'staff' ? 'staff' : 'owner';
if (!name || !email || !password || password.length < MIN_PASSWORD) {
  console.error(`Uso: npm run create-user -- "Nome" email@exemplo.com senha (mín. ${MIN_PASSWORD} caracteres) [owner|staff]`);
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(here, '..', 'data');
const db = openDb(path.join(dataDir, 'marmitaria.db'));
if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) { console.error(`Já existe um usuário com o e-mail ${email}.`); process.exit(1); }
db.prepare('INSERT INTO users(email, name, password_hash, role) VALUES (?,?,?,?)').run(email, name, bcrypt.hashSync(password, 12), role);
console.log(`Usuário ${email} criado (${role === 'owner' ? 'responsável' : 'funcionário'}).`);
