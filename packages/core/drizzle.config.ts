import type { Config } from 'drizzle-kit';
import path from 'path';

const dbPath = process.env.NEURAL_CORE_DB_PATH ?? path.join(process.cwd(), 'neuralcore.db');

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: dbPath,
  },
} satisfies Config;
