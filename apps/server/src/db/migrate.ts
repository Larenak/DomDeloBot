import { loadConfig } from '@domdelo/config';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';

import { createDatabase } from './client.js';

const config = loadConfig();
const { client, db } = createDatabase(config);

try {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), '../../db/migrations/generated') });
  console.info('Database migrations completed');
} finally {
  await client.end();
}

