import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  server: {
    port: 5173,
    open: true,
  },
  resolve: {
    alias: {
      '@stateless-relay/transfer': path.resolve(root, '../transfer/src/index.ts'),
      '@stateless-relay/app': path.resolve(root, '../app/src/index.ts'),
    },
  },
});
