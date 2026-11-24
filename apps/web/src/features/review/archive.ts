import { api } from '../../lib/api.js';
import { showToast } from '../../shell/Toasts.js';
import { useMemoryStore } from '../../store/memoryStore.js';
import { deferAction } from '../memory/deferredAction.js';

/** The server's cap on ids per bulk call. */
const BULK_MAX = 1000;

/** Review removes its rows first; the shared deferred action owns the one
 *  six-second Undo toast, keyboard Undo, and pagehide flush. */
export function archiveMemories(ids: string[], message: string, restore: (archived: ReadonlySet<string>) => void): void {
  const { setHidden, removeRecord } = useMemoryStore.getState();
  ids = [...new Set(ids)];
  const archived = new Set<string>();
  ids.forEach((id) => setHidden(id, true));
  const undo = () => {
    for (const id of ids) {
      if (!archived.has(id)) setHidden(id, false);
    }
    restore(archived);
  };
  deferAction({
    message,
    commit: async (keepalive) => {
      for (let i = 0; i < ids.length; i += BULK_MAX) {
        const chunk = ids.slice(i, i + BULK_MAX);
        await api.bulkArchive(chunk, keepalive);
        // Archived ids stay hidden, so a list with its own rows never shows them again.
        for (const id of chunk) {
          archived.add(id);
          removeRecord(id);
        }
      }
    },
    undo,
    onError: (err) => {
      undo();
      showToast(`Could not archive: ${err instanceof Error ? err.message : 'Engram did not answer'}`);
    },
  });
}
