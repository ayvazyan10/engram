import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/pg/schema.ts',
  out: './src/db/pg/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.ENGRAM_SYNC_URL ?? 'postgresql://localhost:5432/engram',
  },
} satisfies Config;
