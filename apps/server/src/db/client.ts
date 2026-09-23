import type { AppConfig } from '@domdelo/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema.js';

export function createDatabase(config: AppConfig) {
  const client = postgres(config.databaseUrl, {
    max: config.nodeEnv === 'test' ? 1 : 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  const db = drizzle(client, { schema });
  return { client, db };
}

export type Database = ReturnType<typeof createDatabase>['db'];

