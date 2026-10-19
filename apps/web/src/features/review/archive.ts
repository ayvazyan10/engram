import { api } from '../../lib/api.js';

/** The server's cap on ids per bulk call. */
const BULK_MAX = 1000;

/**
 * Archives memories for Review: Keep one side, Archive, and the bulk bar.
 * Every archive in Review goes through here and nowhere else.
 *
 * TODO(F2 merge): replace the body with F2's deferred archive (hide now,
 * "Archived. Undo" toast, send after 6 s). Callers already remove the items
 * themselves and show their own message, so only this body changes.
 */
export async function archiveMemories(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += BULK_MAX) {
    await api.bulkArchive(ids.slice(i, i + BULK_MAX));
  }
}
