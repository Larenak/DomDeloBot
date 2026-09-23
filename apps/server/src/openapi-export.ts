import { loadConfig } from '@domdelo/config';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';

import { buildApp } from './app.js';

const app = await buildApp({
  config: loadConfig({
    NODE_ENV: 'test',
    STORAGE_MODE: 'memory',
    DEMO_MODE: 'true',
    MAX_WEBHOOK_SECRET: 'documentation-only',
  }),
});

try {
  await app.ready();
  const document = app.swagger();
  await writeFile(resolve(process.cwd(), '../../docs/openapi.yaml'), stringify(document), 'utf8');
  console.info('OpenAPI exported to docs/openapi.yaml');
} finally {
  await app.close();
}

