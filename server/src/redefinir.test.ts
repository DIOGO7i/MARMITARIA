// Senha esquecida, trocada pelo painel da hospedagem (variáveis REDEFINIR_SENHA_EMAIL / REDEFINIR_SENHA_NOVA).
import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { openDb } from './db';
import { resetPasswordFromEnv, setPassword } from './auth';

const hashOf = (db: any) => (db.prepare("SELECT password_hash h FROM users WHERE email='gisa@x.com'").get() as any).h;

describe('trocar senha pelo painel', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users(email, name, password_hash, role, active) VALUES ('gisa@x.com','Gisa',?, 'owner', 0)").run(bcrypt.hashSync('esqueci-essa', 4));
  it('sem as variáveis não faz nada', () => { expect(resetPasswordFromEnv(db, {})).toBeNull(); });
  it('só uma das duas: avisa', () => { expect(resetPasswordFromEnv(db, { REDEFINIR_SENHA_EMAIL: 'gisa@x.com' })).toMatch(/preencha as duas/); });
  it('e-mail que não existe: lista os cadastrados', () => {
    expect(resetPasswordFromEnv(db, { REDEFINIR_SENHA_EMAIL: 'gisa@y.com', REDEFINIR_SENHA_NOVA: 'feijao-preto-77' })).toMatch(/Cadastrados: gisa@x.com/);
  });
  it('senha fácil é recusada', () => {
    expect(resetPasswordFromEnv(db, { REDEFINIR_SENHA_EMAIL: 'gisa@x.com', REDEFINIR_SENHA_NOVA: '123456' })).toMatch(/fácil demais/);
  });
  it('troca a senha (e-mail com maiúsculas), reativa o acesso e derruba sessões antigas', () => {
    const tv = (db.prepare("SELECT token_version t FROM users").get() as any).t;
    expect(resetPasswordFromEnv(db, { REDEFINIR_SENHA_EMAIL: ' Gisa@X.com ', REDEFINIR_SENHA_NOVA: 'feijao-preto-77' })).toMatch(/senha de Gisa trocada/);
    expect(bcrypt.compareSync('feijao-preto-77', hashOf(db))).toBe(true);
    const u = db.prepare("SELECT active, token_version t FROM users").get() as any;
    expect(u.active).toBe(1); expect(u.t).toBe(tv + 1);
  });
  it('reiniciar com as mesmas variáveis NÃO desfaz a senha que ela trocou depois', () => {
    setPassword(db, 1, 'minha-nova-senha-9');
    expect(resetPasswordFromEnv(db, { REDEFINIR_SENHA_EMAIL: 'gisa@x.com', REDEFINIR_SENHA_NOVA: 'feijao-preto-77' })).toMatch(/já foi feita antes/);
    expect(bcrypt.compareSync('minha-nova-senha-9', hashOf(db))).toBe(true);
  });
});
