import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { openDb } from './db';
import { restoreFromCloud, startCloudSync } from './cloudsync';

const here = path.dirname(fileURLToPath(import.meta.url));
// Carrega o .env da raiz do projeto, se existir (variáveis já definidas no ambiente têm prioridade).
const envFile = path.join(here, '..', '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(here, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbFile = path.join(dataDir, 'marmitaria.db');

// Hospedagem que apaga os arquivos ao reiniciar (ex.: Render grátis): o banco é guardado num Postgres (ex.: Neon).
const cloudUrl = process.env.DATABASE_URL;
if (cloudUrl) {
  try {
    const r = await restoreFromCloud(cloudUrl, dbFile);
    if (r === 'vazio') console.log('[nuvem] Nenhuma cópia na nuvem ainda: começando com banco novo.');
  } catch (e) {
    console.error(`[nuvem] NÃO consegui buscar o banco na nuvem: ${(e as Error).message}`);
    console.error('[nuvem] O sistema não vai abrir para não começar vazio. Confira a variável DATABASE_URL.');
    process.exit(1);
  }
}
const db = openDb(dbFile);
const sync = cloudUrl ? startCloudSync(db, cloudUrl) : null;

// Segredo do JWT: variável de ambiente (recomendado em produção) ou arquivo gerado automaticamente.
let secret = process.env.JWT_SECRET;
if (!secret) {
  if (process.env.NODE_ENV === 'production') {
    console.error('Defina JWT_SECRET em produção.');
    process.exit(1);
  }
  const f = path.join(dataDir, '.jwt_secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  secret = fs.readFileSync(f, 'utf8');
}

const port = Number(process.env.PORT ?? 3001);
const staticDir = path.join(here, '..', '..', 'web', 'dist');
const app = createApp(db, secret, { staticDir, corsOrigin: process.env.CORS_ORIGIN });
const server = app.listen(port, () => console.log(`Marmitaria rodando em http://localhost:${port}`));
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  O sistema JA ESTA ABERTO em outra janela (porta ${port} ocupada).`);
    console.error('  Feche a outra janela preta do sistema e tente de novo,');
    console.error(`  ou simplesmente use o que ja esta aberto em http://localhost:${port}\n`);
  } else console.error(e);
  process.exit(1);
});

// Ao desligar (o Render manda SIGTERM ao reiniciar ou atualizar): envia a última cópia antes de sair.
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    if (sync) await sync.close();
    process.exit(0);
  });
}
