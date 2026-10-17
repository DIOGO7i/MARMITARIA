import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb } from './db';
import { createApp } from './app';
import jwt from 'jsonwebtoken';
import { setPassword } from './auth';

const sent: { to: string; text: string }[] = [];
let server: Server; let base: string;
let serverNoMail: Server; let baseNoMail: string;

const call = async (b: string, method: string, url: string, body?: unknown, token?: string) => {
  const r = await fetch(b + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() as any };
};

beforeAll(() => {
  server = createApp(openDb(':memory:'), 'segredo', { mailer: { send: async (to, _s, text) => { sent.push({ to, text }); } } }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  serverNoMail = createApp(openDb(':memory:'), 'segredo', { mailer: null }).listen(0);
  baseNoMail = `http://127.0.0.1:${(serverNoMail.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); serverNoMail.close(); });

describe('login simples', () => {
  it('primeiro acesso sem código de recuperação; senha de 6 letras; sessão de 30 dias', async () => {
    expect((await call(baseNoMail, 'POST', '/api/auth/setup', { name: 'Maria', email: 'maria@x.com', password: '12345' })).status).toBe(400); // curta demais
    const s = await call(baseNoMail, 'POST', '/api/auth/setup', { name: 'Maria', email: 'maria@x.com', password: 'gisa26' });
    expect(s.status).toBe(200);
    expect(s.body.recoveryCode).toBeUndefined();
    const p = jwt.decode(s.body.token) as any;
    expect(p.exp - p.iat).toBe(30 * 24 * 3600);
    const me = await call(baseNoMail, 'GET', '/api/me', undefined, s.body.token);
    expect(me.body).toEqual({ id: 1, name: 'Maria', email: 'maria@x.com', role: 'owner' });
    expect((await call(baseNoMail, 'GET', '/api/auth/status')).body.emailReset).toBe(false);
    // rotas do antigo código de recuperação não existem mais
    expect((await call(baseNoMail, 'POST', '/api/auth/recover', { email: 'maria@x.com', code: 'AAAA-AAAA-AAAA-AAAA', newPassword: 'nova-123' })).status).not.toBe(200);
    // sem e-mail configurado, "esqueci a senha" avisa para falar com quem instalou
    const f = await call(baseNoMail, 'POST', '/api/auth/forgot', { email: 'maria@x.com' });
    expect(f.status).toBe(501);
    expect(f.body.error).toMatch(/quem instalou/);
  });

  it('senha trocada pelo suporte (comando nova-senha) derruba as sessões abertas', async () => {
    const db = openDb(':memory:');
    const srv = createApp(db, 'segredo', { mailer: null }).listen(0);
    const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const s = await call(b, 'POST', '/api/auth/setup', { name: 'Gisa', email: 'gisa@x.com', password: 'antiga1' });
      setPassword(db, s.body.user.id, 'novinha');
      expect((await call(b, 'GET', '/api/me', undefined, s.body.token)).status).toBe(401);
      expect((await call(b, 'POST', '/api/auth/login', { email: 'gisa@x.com', password: 'antiga1' })).status).toBe(401);
      expect((await call(b, 'POST', '/api/auth/login', { email: 'gisa@x.com', password: 'novinha' })).status).toBe(200);
    } finally { srv.close(); }
  });

  it('bloqueia tentativas repetidas de adivinhar a senha', async () => {
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await call(baseNoMail, 'POST', '/api/auth/login', { email: 'maria@x.com', password: 'chute-' + i })).status;
    expect(last).toBe(429);
  });
});

describe('troca de senha (logado)', () => {
  it('exige a senha atual; derruba outras sessões; mantém a atual', async () => {
    const a = await call(base, 'POST', '/api/auth/setup', { name: 'Ana', email: 'ana@x.com', password: 'senha-ana-001' });
    const other = (await call(base, 'POST', '/api/auth/login', { email: 'ana@x.com', password: 'senha-ana-001' })).body.token;
    expect((await call(base, 'POST', '/api/me/password', { currentPassword: 'errada', newPassword: 'senha-ana-002' }, a.body.token)).status).toBe(400);
    expect((await call(base, 'POST', '/api/me/password', { currentPassword: 'senha-ana-001', newPassword: 'curt' }, a.body.token)).status).toBe(400);
    const ch = await call(base, 'POST', '/api/me/password', { currentPassword: 'senha-ana-001', newPassword: 'senha-ana-002' }, a.body.token);
    expect(ch.status).toBe(200);
    expect((await call(base, 'GET', '/api/me', undefined, other)).status).toBe(401);
    expect((await call(base, 'GET', '/api/me', undefined, ch.body.token)).status).toBe(200);
  });
});

describe('redefinição por e-mail', () => {
  it('envia link, o link troca a senha uma única vez, e não revela e-mails inexistentes', async () => {
    expect((await call(base, 'GET', '/api/auth/status')).body.emailReset).toBe(true);
    const none = await call(base, 'POST', '/api/auth/forgot', { email: 'ninguem@x.com' });
    expect(none.status).toBe(200);
    expect(sent).toHaveLength(0);
    const r = await call(base, 'POST', '/api/auth/forgot', { email: 'ana@x.com' });
    expect(r.body.message).toBe(none.body.message); // mesma resposta
    expect(sent).toHaveLength(1);
    const token = sent[0].text.match(/token=([a-f0-9]{64})/)![1];
    const ok = await call(base, 'POST', '/api/auth/reset', { token, newPassword: 'senha-pelo-email' });
    expect(ok.status).toBe(200);
    expect((await call(base, 'POST', '/api/auth/login', { email: 'ana@x.com', password: 'senha-pelo-email' })).status).toBe(200);
    expect((await call(base, 'POST', '/api/auth/reset', { token, newPassword: 'de-novo-12345' })).status).toBe(400); // uso único
    expect((await call(base, 'POST', '/api/auth/reset', { token: 'f'.repeat(64), newPassword: 'de-novo-12345' })).status).toBe(400);
  });
});

describe('proteções da senha curta', () => {
  it('recusa senhas óbvias e aceita uma razoável', async () => {
    const { checkStrength } = await import('./auth');
    for (const p of ['123456', 'senha123', 'aaaaaa', 'abcdef', '987654', 'marmita', 'gisa26', 'gisagastro']) {
      expect(() => checkStrength(p, 'gisagastro@x.com', 'Gisa Silva'), p).toThrow(/fácil demais/);
    }
    expect(() => checkStrength('feijoada7', 'gisagastro@x.com', 'Gisa Silva')).not.toThrow();
  });

  it('limite por conta vale mesmo trocando de IP; e-mail inexistente responde igual', async () => {
    process.env.TRUST_PROXY = '1'; // para simular IPs diferentes com X-Forwarded-For
    const db = openDb(':memory:');
    const srv = createApp(db, 'segredo', { mailer: null }).listen(0);
    delete process.env.TRUST_PROXY;
    const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const tryFrom = async (ip: string, password: string) => (await fetch(b + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ email: 'g@x.com', password }) })).status;
    try {
      await call(b, 'POST', '/api/auth/setup', { name: 'Gisa', email: 'g@x.com', password: 'feijoada7' });
      const none = await call(b, 'POST', '/api/auth/login', { email: 'ninguem@x.com', password: 'qualquer1' });
      const wrong = await call(b, 'POST', '/api/auth/login', { email: 'g@x.com', password: 'qualquer1' });
      expect(none).toEqual(wrong);
      // 20 erros espalhados em 10 IPs (2 por IP, abaixo do limite por IP) → a conta trava mesmo assim
      for (let i = 0; i < 19; i++) expect(await tryFrom(`10.0.0.${i % 10}`, 'chute' + i)).toBe(401);
      expect(await tryFrom('10.0.0.99', 'chute-final')).toBe(429);
      expect(await tryFrom('10.0.0.98', 'feijoada7')).toBe(429); // nem a senha certa entra até passar o bloqueio
    } finally { srv.close(); }
  }, 30000);

  it('sair de todos os aparelhos derruba todas as sessões', async () => {
    const db = openDb(':memory:');
    const srv = createApp(db, 'segredo', { mailer: null }).listen(0);
    const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const s = await call(b, 'POST', '/api/auth/setup', { name: 'Gisa', email: 'g@x.com', password: 'feijoada7' });
      const outro = (await call(b, 'POST', '/api/auth/login', { email: 'g@x.com', password: 'feijoada7' })).body.token;
      expect((await call(b, 'POST', '/api/me/logout-all', {}, s.body.token)).status).toBe(200);
      expect((await call(b, 'GET', '/api/me', undefined, outro)).status).toBe(401);
      expect((await call(b, 'GET', '/api/me', undefined, s.body.token)).status).toBe(401);
    } finally { srv.close(); }
  });

  it('cabeçalhos de segurança (CSP) em todas as respostas', async () => {
    const r = await fetch(baseNoMail + '/api/health');
    expect(r.headers.get('content-security-policy')).toMatch(/default-src 'self'.*frame-ancestors 'self'/);
    expect(r.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });
});
