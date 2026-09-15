import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Único .env do monorepo fica na raiz, não em /frontend (CLAUDE.md 1.4).
  envDir: path.resolve(__dirname, '..'),
  server: {
    port: 5183,
    // "true" liga em todas as interfaces — necessário pra funcionar também
    // quando este processo roda dentro de um container Docker (CLAUDE.md 1.2).
    host: true,
    // Watch por polling: bind mounts do Docker no Windows às vezes não
    // propagam eventos nativos de sistema de arquivos.
    watch: { usePolling: true },
    // Em dev, o navegador só fala com a origem do Vite; ele repassa /api pro
    // backend por baixo dos panos — sem CORS, sem URL de API configurável.
    proxy: {
      '/api': 'http://localhost:8090',
    },
  },
});
