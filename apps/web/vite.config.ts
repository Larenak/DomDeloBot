import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: [
      '.trycloudflare.com',
      '.pinggy-free.link',
      '.pinggy.net',
      '.pinggy.link',
      '.lhr.life',
      '.localhost.run',
    ],
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/webhooks': 'http://localhost:3000',
    },
  },
  build: {
    sourcemap: true,
  },
});
