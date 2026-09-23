import { loadConfig } from '@domdelo/config';

import { buildApp } from './app.js';

const config = loadConfig();
const app = await buildApp({ config });

const close = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => void close('SIGINT'));
process.on('SIGTERM', () => void close('SIGTERM'));

try {
  await app.listen({ host: '0.0.0.0', port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

