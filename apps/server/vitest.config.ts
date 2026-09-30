import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@domdelo/contracts': fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url)),
      '@domdelo/domain': fileURLToPath(new URL('../../packages/domain/src/index.ts', import.meta.url)),
      '@domdelo/config': fileURLToPath(new URL('../../packages/config/src/index.ts', import.meta.url)),
    },
  },
});
