/**
 * Shared cleanup for temp SQLite databases created in tests.
 *
 * A test database is never just one file: better-sqlite3 leaves behind
 * `-wal`/`-shm`/`-journal` siblings, and `NeuralBrain` writes a vector index
 * cache next to it at `${dbPath}.index` (see `resolveIndexPath()` in
 * `NeuralBrain.ts`). When `namespaceMode` is `'isolated'`, that resolver
 * appends a namespace-hash suffix instead — `${dbPath}.index.<12-hex>` — so
 * even the exact `.index` path isn't a fixed name.
 *
 * Deleting by a hardcoded suffix list (`['', '-wal', '-shm']`, sometimes with
 * `-journal`, sometimes with `.index`) is exactly how this leaked in the
 * first place: every suite copy-pasted its own list and each one fell behind
 * as new sidecar types were added. Scanning the directory for every entry
 * whose name starts with the db file's basename is correct by construction —
 * a future sidecar (or another namespace-hash suffix) can't leak just
 * because nobody remembered to add it to a list.
 *
 * Duplicated (not imported) from packages/core/src/test-helpers/cleanupTestDb.ts:
 * this package builds and tests independently of @engram-ai-memory/core, and
 * that package only publishes its compiled `dist` as `@engram-ai-memory/core`
 * — it does not export test utilities. Keep both copies identical.
 */
import fs from 'fs';
import path from 'path';

export function cleanupTestDb(dbPath: string): void {
  if (!dbPath) return;

  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath);

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return; // directory already gone — nothing to clean up
  }

  for (const entry of entries) {
    if (!entry.startsWith(base)) continue;
    try {
      fs.unlinkSync(path.join(dir, entry));
    } catch {
      // already gone, or not a plain file — ignore
    }
  }
}
