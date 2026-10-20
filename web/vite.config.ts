import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// número da versão aparece na tela (para conferir se o celular já pegou a atualização)
const version = (() => { try { return readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim(); } catch { return '?'; } })();

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001' } },
});
