import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: '../../db/migrations/generated',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgres://domdelo:domdelo@localhost:5432/domdelo',
  },
});

