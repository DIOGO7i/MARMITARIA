// Cópia do banco no Postgres (Neon). Precisa de um Postgres de teste: TEST_PG_URL=postgres://... npm test
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import pg from 'pg';
import { openDb } from './db';
import { restoreFromCloud, startCloudSync } from './cloudsync';

const url = process.env.TEST_PG_URL;
const d = describe.skipIf(!url);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuvem-'));
const file = (n: string) => path.join(dir, n);
let admin: pg.Pool;
const rows = async () => (await admin.query('SELECT nome, bytes FROM marmitaria_copias ORDER BY nome')).rows as { nome: string; bytes: number }[];
const count = (f: string, t: string) => {
  const db = openDb(f); const n = (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as any).n; db.close(); return n;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  if (!url) return;
  admin = new pg.Pool({ connectionString: url });
  await admin.query('DROP TABLE IF EXISTS marmitaria_copias');
});
afterAll(async () => { await admin?.end(); fs.rmSync(dir, { recursive: true, force: true }); });

d('cópia do banco no Postgres', () => {
  it('primeira vez: não há cópia, começa vazio', async () => {
    expect(await restoreFromCloud(url!, file('a.db'), 1)).toBe('vazio');
    expect(fs.existsSync(file('a.db'))).toBe(false);
  });

  it('envia a cópia depois de gravar, e não reenvia sem mudança', async () => {
    const db = openDb(file('a.db'));
    const sync = startCloudSync(db, url!, { checkMs: 50, debounceMs: 50 });
    await sync.flush();
    expect(sync.uploads).toBe(0); // nada gravado ainda desde que começou
    db.prepare("INSERT INTO customers(name, phone) VALUES ('Maria', '16991515757')").run();
    await sync.flush();
    expect(sync.uploads).toBe(1);
    await sync.flush();
    await sync.flush();
    expect(sync.uploads).toBe(1); // a própria cópia não conta como mudança
    const r = await rows();
    expect(r.map((x) => x.nome)).toEqual(['atual', expect.stringMatching(/^dia-\d{4}-\d{2}-\d{2}$/)]);
    await sync.close();
    db.close();
  });

  it('envia sozinho, poucos segundos depois de gravar', async () => {
    const db = openDb(file('a.db'));
    const sync = startCloudSync(db, url!, { checkMs: 30, debounceMs: 60 });
    db.prepare("INSERT INTO customers(name, phone) VALUES ('João', '16993907272')").run();
    for (let i = 0; i < 100 && sync.uploads === 0; i++) await sleep(20);
    expect(sync.uploads).toBe(1);
    await sync.close();
    db.close();
  });

  it('reiniciar num disco vazio traz tudo de volta', async () => {
    expect(await restoreFromCloud(url!, file('b.db'), 1)).toBe('restaurado');
    expect(count(file('b.db'), 'customers')).toBe(2);
  });

  it('ao desligar, envia o que ainda não foi enviado', async () => {
    const db = openDb(file('b.db'));
    const sync = startCloudSync(db, url!, { checkMs: 60_000, debounceMs: 60_000 });
    db.prepare("INSERT INTO customers(name, phone) VALUES ('Ana', '16990000000')").run();
    await sync.close();
    db.close();
    expect(await restoreFromCloud(url!, file('c.db'), 1)).toBe('restaurado');
    expect(count(file('c.db'), 'customers')).toBe(3);
  });

  it('apaga cópias diárias com mais de 30 dias e guarda as recentes', async () => {
    const gz = zlib.gzipSync(Buffer.from('x'));
    await admin.query("INSERT INTO marmitaria_copias(nome, bytes, dados) VALUES ('dia-2020-01-01', 1, $1), ('dia-2099-01-01', 1, $1)", [gz]);
    const db = openDb(file('c.db'));
    const sync = startCloudSync(db, url!, { checkMs: 60_000 });
    db.prepare("INSERT INTO customers(name, phone) VALUES ('Bia', '16990000001')").run();
    await sync.flush();
    const nomes = (await rows()).map((x) => x.nome);
    expect(nomes).not.toContain('dia-2020-01-01');
    expect(nomes).toContain('dia-2099-01-01');
    await admin.query("DELETE FROM marmitaria_copias WHERE nome = 'dia-2099-01-01'");
    await sync.close();
    db.close();
  });

  it('cópia estragada na nuvem: NÃO abre (nunca começa vazio por cima)', async () => {
    const atual = (await admin.query("SELECT dados FROM marmitaria_copias WHERE nome = 'atual'")).rows[0].dados;
    await admin.query("UPDATE marmitaria_copias SET dados = $1 WHERE nome = 'atual'", [zlib.gzipSync(Buffer.from('lixo'.repeat(100)))]);
    await expect(restoreFromCloud(url!, file('d.db'), 1)).rejects.toThrow(/não é um banco válido/);
    await admin.query("UPDATE marmitaria_copias SET dados = $1 WHERE nome = 'atual'", [atual]);
  });

  it('nuvem fora do ar na partida: dá erro em vez de começar vazio', async () => {
    await expect(restoreFromCloud('postgres://x:y@127.0.0.1:1/nada', file('e.db'), 2)).rejects.toThrow();
    expect(fs.existsSync(file('e.db'))).toBe(false);
  });

  it('nuvem fora do ar durante o uso: o sistema continua e tenta de novo', async () => {
    const db = openDb(file('f.db'));
    const sync = startCloudSync(db, 'postgres://x:y@127.0.0.1:1/nada', { checkMs: 60_000 });
    db.prepare("INSERT INTO customers(name, phone) VALUES ('Caio', '16990000002')").run();
    await sync.flush(); // não lança
    expect(sync.uploads).toBe(0);
    expect(count(file('f.db'), 'customers')).toBe(1); // dado continua no disco
    await sync.close();
    db.close();
  }, 30_000);
});
