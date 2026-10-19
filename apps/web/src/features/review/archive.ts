import { api } from '../../lib/api.js';
import { showToast } from '../../shell/Toasts.js';
import { useMemoryStore } from '../../store/memoryStore.js';
import { deferAction } from '../memory/deferredAction.js';

/** The server's cap on ids per bulk call. */
const BULK_MAX = 1000;

/** Review removes its rows first; the shared deferred action owns the one
 *  six-second Undo toast, keyboard Undo, and pagehide flush. */
export function archiveMemories(ids: string[], message: string, restore: () => void): void {
  const { setHidden, removeRecord } = useMemoryStore.getState();
  ids = [...new Set(ids)];
  ids.forEach((id) => setHidden(id, true));
  const undo = () => {
    ids.forEach((id) => setHidden(id, false));
    restore();
  };
  deferAction({
    message,
    commit: async (keepalive) => {
      for (let i = 0; i < ids.length; i += BULK_MAX) {
        const chunk = ids.slice(i, i + BULK_MAX);
        await api.bulkArchive(chunk, keepalive);
        chunk.forEach((id) => {
          removeRecord(id);
          setHidden(id, false);
        });
      }
    },
    undo,
    onError: (err) => {
      undo();
      showToast(`Could not archive: ${err instanceof Error ? err.message : 'Engram did not answer'}`);
    },
  });
}
