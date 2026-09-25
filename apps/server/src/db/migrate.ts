import { loadConfig } from '@domdelo/config';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';

import { createDatabase } from './client.js';

const config = loadConfig();
const { client, db } = createDatabase(config);

try {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../../../db/migrations/generated/', import.meta.url)),
  });
  console.info('Database migrations completed');
} finally {
  await client.end();
}
