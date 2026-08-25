/**
 * Device identity for multi-device sync.
 *
 * Every Engram installation (one local `engram.db`) gets a stable per-install
 * UUID, generated once and persisted in the device-local `local_meta` table
 * (`key = 'device_id'`). `local_meta` is never synced to Postgres — it exists
 * specifically to hold facts that must stay unique per physical machine.
 * See `.claude/PRPs/plans/postgres-cloud-sync.md` (section 3, Фаза 0) for the
 * full sync design this feeds into.
 *
 * The id is memoized in a module-level variable so repeated calls don't
 * round-trip through SQLite — it is read from disk at most once per process.
 *
 * KNOWN CAVEAT: copying `engram.db` to another machine (backup restore, disk
 * clone, `cp`) duplicates the device id onto both installations. `device_id`
 * is used to deterministically break last-write-wins ties during sync, so two
 * devices sharing one id can silently mis-resolve a conflict between exactly
 * those two devices. A future `engram cloud reset-device-id` command will let
 * a cloned installation mint a fresh id; until then, treat a restored/cloned
 * `engram.db` as sharing identity with its source machine.
 */

import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDb, schema } from '../db/index.js';

let cachedDeviceId: string | null = null;

/**
 * Get this installation's stable device id, generating and persisting one on
 * first call if it doesn't exist yet.
 */
export function getDeviceId(): string {
  if (cachedDeviceId) {
    return cachedDeviceId;
  }

  const db = getDb();

  const existing = db
    .select()
    .from(schema.localMeta)
    .where(eq(schema.localMeta.key, 'device_id'))
    .get();

  if (existing) {
    cachedDeviceId = existing.value;
    return cachedDeviceId;
  }

  const deviceId = uuidv4();

  // Two processes can reach this point concurrently against one fresh database
  // — Engram routinely runs the REST server, the MCP server and the CLI against
  // a single file. A plain insert makes the loser throw SQLITE_CONSTRAINT on
  // local_meta.key, which surfaces as an unrelated HTTP 500. Instead the loser's
  // insert is a no-op and it adopts the winner's id, so both agree.
  db.insert(schema.localMeta)
    .values({ key: 'device_id', value: deviceId })
    .onConflictDoNothing()
    .run();

  const stored = db
    .select()
    .from(schema.localMeta)
    .where(eq(schema.localMeta.key, 'device_id'))
    .get();

  cachedDeviceId = stored?.value ?? deviceId;
  return cachedDeviceId;
}

/**
 * Test-only escape hatch: clears the in-process memo so the next
 * `getDeviceId()` call re-reads `local_meta` from disk instead of returning
 * the cached value. Not exported from the package's public entry point.
 */
export function _resetMemoizedDeviceIdForTests(): void {
  cachedDeviceId = null;
}
