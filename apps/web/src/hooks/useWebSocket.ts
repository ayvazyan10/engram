import { useEffect } from 'react';
import { getSocket } from '../lib/socket.js';
import { useNeuralStore } from '../store/neuralStore.js';
import { useMemoryStore, type MemoryRecord } from '../store/memoryStore.js';
import { useAuthStore } from '../store/authStore.js';
import { getStoredApiKey } from '../lib/apiKey.js';

/**
 * Narrow an untrusted socket payload to a usable memory record.
 *
 * The server broadcasts rows straight from the DB; anything missing the fields
 * the UI renders is dropped rather than inserted, because there is no error
 * boundary and `record.content.slice(...)` on a partial payload would blank the
 * whole dashboard.
 *
 * Exported for unit testing (F1) — it's the one piece of this hook that's
 * plain logic rather than socket wiring.
 */
export function asMemoryRecord(payload: unknown): MemoryRecord | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Partial<MemoryRecord> & { archivedAt?: string | null };
  if (typeof record.id !== 'string') return null;
  if (typeof record.content !== 'string') return null;
  if (typeof record.type !== 'string') return null;
  // Auto-resolution (keep_oldest / keep_important) can archive the memory in
  // the same request that created it. The server still emits 'memory:stored'
  // for it (result.memory keeps its archivedAt), so without this check a
  // discarded row appears as a phantom memory that vanishes on reload.
  if (record.archivedAt) return null;
  return record as MemoryRecord;
}

/**
 * Whether a socket `connect_error` came from the server's ENGRAM_API_KEY
 * middleware (apps/server/src/index.ts: `next(new Error('Unauthorized: ...'))`)
 * rather than a transport-level failure (server down, network blip). Only an
 * auth-flavored error should open the unlock gate — a generic connection
 * failure is a different, unrelated problem.
 *
 * Exported for unit testing (F2).
 */
export function isAuthConnectError(err: unknown): boolean {
  return err instanceof Error && /unauthorized/i.test(err.message);
}

export function useWebSocket() {
  const setConnected = useNeuralStore((s) => s.setConnected);
  const addRecord = useMemoryStore((s) => s.addRecord);

  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => {
      setConnected(true);
      // A successful handshake proves whatever key is in play (or none, if
      // none is required) works — clear a stale unlock gate (F2).
      useAuthStore.getState().unlock();
    };
    const onDisconnect = () => setConnected(false);
    const onConnectError = (err: unknown) => {
      if (isAuthConnectError(err)) {
        useAuthStore.getState().lock(Boolean(getStoredApiKey()));
      }
    };
    const onStored = (payload: unknown) => {
      const record = asMemoryRecord(payload);
      if (record) addRecord(record);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    // NOTE: 'neuron:activated' was subscribed here but is never emitted by the
    // server — removed rather than left as a dead listener.
    socket.on('memory:stored', onStored);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('memory:stored', onStored);
    };
  }, [setConnected, addRecord]);
}
