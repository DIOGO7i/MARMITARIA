// Adaptador fino sobre o SQLite embutido no Node.js (node:sqlite), sem dependências nativas para compilar.
// Expõe a mesma interface usada pelo restante do código: prepare().run/get/all, exec e transaction().
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncT, StatementSync } from 'node:sqlite';

// Carregado em tempo de execução (o empacotador dos testes não reconhece 'node:sqlite' como módulo nativo).
// O aviso "experimental" do Node é silenciado só para este módulo.
const origEmit = process.emitWarning;
process.emitWarning = ((w: any, ...rest: any[]) => {
  if (String(w).includes('SQLite is an experimental feature')) return;
  return (origEmit as any).call(process, w, ...rest);
}) as typeof process.emitWarning;
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: typeof DatabaseSyncT };
process.emitWarning = origEmit;

type Param = string | number | bigint | null | Uint8Array;

export interface Statement {
  run(...params: Param[]): { changes: number; lastInsertRowid: number };
  get(...params: Param[]): unknown;
  all(...params: Param[]): unknown[];
}

export class Database {
  private raw: DatabaseSyncT;
  private depth = 0;
  private cache = new Map<string, StatementSync>();

  constructor(file: string) {
    this.raw = new DatabaseSync(file);
  }

  exec(sql: string) { this.raw.exec(sql); }

  pragma(p: string) { this.raw.exec(`PRAGMA ${p}`); }

  prepare(sql: string): Statement {
    let st = this.cache.get(sql);
    if (!st) { st = this.raw.prepare(sql); this.cache.set(sql, st); }
    const s = st;
    return {
      run: (...p) => { const r = s.run(...p); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; },
      get: (...p) => { const r = s.get(...p); return r === undefined ? undefined : { ...r }; },
      all: (...p) => s.all(...p).map((r) => ({ ...r })),
    };
  }

  /** Envolve fn numa transação (BEGIN IMMEDIATE / COMMIT / ROLLBACK). Chamadas aninhadas usam SAVEPOINT. */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A) => {
      const sp = `sp${this.depth}`;
      this.raw.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
      this.depth++;
      try {
        const out = fn(...args);
        this.depth--;
        this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
        return out;
      } catch (e) {
        this.depth--;
        this.raw.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw e;
      }
    };
  }

  close() { this.raw.close(); }
}
