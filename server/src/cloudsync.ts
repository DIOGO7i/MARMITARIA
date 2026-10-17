// Cópia do banco na nuvem (Neon / qualquer Postgres) para hospedagens que apagam os arquivos ao reiniciar,
// como o plano grátis do Render.
//
// Como funciona:
//  - Na partida, ANTES de abrir o banco, busca a última cópia no Postgres e grava no disco.
//  - Enquanto roda, confere a cada poucos segundos se algo foi gravado no banco; se foi, alguns
//    segundos depois manda uma cópia completa (compactada) para o Postgres.
//  - Guarda também uma cópia por dia, por 30 dias.
//  - Ao desligar (o Render avisa com SIGTERM), manda a cópia final antes de sair.
//
// Segurança: se existir cópia na nuvem e ela não puder ser lida, o sistema NÃO abre (para nunca
// começar com o banco vazio e depois mandar esse banco vazio por cima da cópia boa).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import pg from 'pg';
import type { DB } from './db';

const TABLE = 'marmitaria_copias';
const SQLITE_HEADER = 'SQLite format 3\0';
const KEEP_DAYS = 30;

function pool(url: string) {
  return new pg.Pool({ connectionString: url, max: 2, idleTimeoutMillis: 60_000, connectionTimeoutMillis: 20_000 });
}

async function retry<T>(what: string, tries: number, fn: () => Promise<T>): Promise<T> {
  let wait = 1000;
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries) throw e;
      console.warn(`[nuvem] ${what} falhou (tentativa ${i}/${tries}): ${(e as Error).message}. Tentando de novo...`);
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 15_000);
    }
  }
}

async function ensureTable(p: pg.Pool) {
  await p.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    nome TEXT PRIMARY KEY,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    bytes INTEGER NOT NULL,
    dados BYTEA NOT NULL
  )`);
}

const isSqlite = (b: Buffer) => b.length > 100 && b.subarray(0, 16).toString('latin1') === SQLITE_HEADER;

/**
 * Busca a última cópia na nuvem e grava em `dbFile`.
 * 'restaurado' = havia cópia; 'vazio' = primeira vez (nenhuma cópia ainda). Lança erro se não conseguir.
 */
export async function restoreFromCloud(url: string, dbFile: string, tries = 6): Promise<'restaurado' | 'vazio'> {
  const p = pool(url);
  try {
    const row = await retry('ler a cópia da nuvem', tries, async () => {
      await ensureTable(p);
      const r = await p.query<{ dados: Buffer; criado_em: Date }>(`SELECT dados, criado_em FROM ${TABLE} WHERE nome = 'atual'`);
      return r.rows[0];
    });
    if (!row) return 'vazio';
    const raw = zlib.gunzipSync(row.dados);
    if (!isSqlite(raw)) throw new Error('A cópia da nuvem não é um banco válido.');
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });
    const tmp = `${dbFile}.baixando`;
    fs.writeFileSync(tmp, raw);
    fs.renameSync(tmp, dbFile);
    console.log(`[nuvem] Banco restaurado da cópia de ${row.criado_em.toISOString()} (${Math.round(raw.length / 1024)} KB).`);
    return 'restaurado';
  } finally {
    await p.end().catch(() => {});
  }
}

export interface CloudSync {
  /** Manda a cópia agora, se algo mudou desde a última. */
  flush(): Promise<void>;
  /** Manda a cópia final e encerra a conexão. */
  close(): Promise<void>;
  /** Para os testes: quantas cópias já foram enviadas. */
  readonly uploads: number;
}

export function startCloudSync(db: DB, url: string, opts: { checkMs?: number; debounceMs?: number; timezone?: string } = {}): CloudSync {
  const checkMs = opts.checkMs ?? 3000;
  const debounceMs = opts.debounceMs ?? 4000;
  const tz = opts.timezone ?? 'America/Sao_Paulo';
  const p = pool(url);
  const changes = () => Number((db.prepare('SELECT total_changes() AS n').get() as { n: number }).n);

  let sent = changes();        // contador de gravações já incluído na última cópia enviada
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<void> | null = null;
  let uploads = 0;
  let closed = false;
  let tableReady = false;

  const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

  async function upload() {
    const now = changes();
    if (now === sent) return;
    const tmp = path.join(os.tmpdir(), `marmitaria-nuvem-${process.pid}-${Date.now()}.db`);
    let raw: Buffer;
    try {
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      raw = fs.readFileSync(tmp);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    if (!isSqlite(raw)) throw new Error('Cópia local inválida; não enviada.');
    const gz = zlib.gzipSync(raw, { level: 6 });
    if (!tableReady) { await ensureTable(p); tableReady = true; }
    const up = `INSERT INTO ${TABLE}(nome, criado_em, bytes, dados) VALUES ($1, now(), $2, $3)
                ON CONFLICT (nome) DO UPDATE SET criado_em = now(), bytes = EXCLUDED.bytes, dados = EXCLUDED.dados`;
    const c = await p.connect();
    try {
      await c.query('BEGIN');
      await c.query(up, ['atual', raw.length, gz]);
      await c.query(up, [`dia-${day()}`, raw.length, gz]);
      const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000);
      await c.query(`DELETE FROM ${TABLE} WHERE nome LIKE 'dia-%' AND nome < $1`, [`dia-${new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(cutoff)}`]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
    sent = now;
    uploads++;
  }

  function flush(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    if (running) return running.then(() => (changes() !== sent ? flush() : undefined));
    running = upload()
      .catch((e) => {
        console.error(`[nuvem] Não consegui enviar a cópia: ${(e as Error).message}. Tento de novo em 30 s.`);
        if (!closed && !timer) timer = setTimeout(() => { timer = null; void flush(); }, 30_000);
      })
      .finally(() => { running = null; });
    return running;
  }

  const watch = setInterval(() => {
    if (!closed && !timer && !running && changes() !== sent) {
      timer = setTimeout(() => { timer = null; void flush(); }, debounceMs);
    }
  }, checkMs);
  watch.unref();

  return {
    flush,
    async close() {
      closed = true;
      clearInterval(watch);
      if (timer) { clearTimeout(timer); timer = null; }
      if (running) await running;
      await upload().catch((e) => console.error(`[nuvem] Cópia final falhou: ${(e as Error).message}`));
      await p.end().catch(() => {});
    },
    get uploads() { return uploads; },
  };
}
