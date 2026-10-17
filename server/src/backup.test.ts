// Cópia de segurança: a responsável baixa o banco inteiro; funcionário não pode.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from './db';
import { createApp } from './app';

let server: Server; let base: string; let gisa: string; let func: string;
beforeAll(async () => {
  server = createApp(openDb(':memory:'), 'segredo', { mailer: null, route: null, places: null }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const j = (u: string, b: any, t?: string) => fetch(base + '/api' + u, { method: 'POST', headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(b) }).then((r) => r.json() as any);
  gisa = (await j('/auth/setup', { name: 'Gisa', email: 'gisa@x.com', password: 'feijoada7' })).token;
  await j('/users', { name: 'Ana', email: 'ana@x.com', password: 'cozinha24' }, gisa);
  func = (await j('/auth/login', { email: 'ana@x.com', password: 'cozinha24' })).token;
}, 30000);
afterAll(() => server.close());

describe('cópia de segurança', () => {
  it('responsável baixa um banco SQLite válido, com os dados', async () => {
    const r = await fetch(base + '/api/backup', { headers: { authorization: `Bearer ${gisa}` } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toMatch(/marmitaria-copia-\d{4}-\d{2}-\d{2}\.db/);
    const buf = Buffer.from(await r.arrayBuffer());
    expect(buf.subarray(0, 15).toString()).toBe('SQLite format 3');
    const f = path.join(os.tmpdir(), `teste-copia-${Date.now()}.db`); fs.writeFileSync(f, buf);
    const db = new DatabaseSync(f);
    expect((db.prepare('SELECT COUNT(*) n FROM users').get() as any).n).toBe(2);
    db.close(); fs.rmSync(f);
  });
  it('funcionário não pode baixar', async () => {
    const r = await fetch(base + '/api/backup', { headers: { authorization: `Bearer ${func}` } });
    expect(r.status).toBe(403);
  });
  it('sem login não pode baixar', async () => {
    expect((await fetch(base + '/api/backup')).status).toBe(401);
  });
});
