import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'path';
import * as schema from './schema.js';

export type { Memory, NewMemory, MemoryType, RelationshipType, MemoryConnection, NewMemoryConnection, Session, NewSession, ContextAssembly, NewContextAssembly } from './schema.js';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function getDb(dbPath?: string): ReturnType<typeof drizzle<typeof schema>> {
  if (_db) return _db;

  const resolvedPath =
    dbPath ??
    process.env['NEURAL_CORE_DB_PATH'] ??
    path.join(process.cwd(), 'neuralcore.db');

  _sqlite = new Database(resolvedPath);

  // Enable WAL mode for better write performance
  _sqlite.pragma('journal_mode = WAL');
  _sqlite.pragma('synchronous = NORMAL');
  _sqlite.pragma('cache_size = 10000');
  _sqlite.pragma('foreign_keys = ON');

  _db = drizzle(_sqlite, { schema });
  return _db;
}

export function closeDb(): void {
  _sqlite?.close();
  _db = null;
  _sqlite = null;
}

export { schema };

