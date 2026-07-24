import { useEffect } from 'react';
import { getSocket } from '../lib/socket.js';
import { useNeuralStore } from '../store/neuralStore.js';
import { useMemoryStore, type MemoryRecord } from '../store/memoryStore.js';

/**
 * Narrow an untrusted socket payload to a usable memory record.
 *
 * The server broadcasts rows straight from the DB; anything missing the fields
 * the UI renders is dropped rather than inserted, because there is no error
 * boundary and `record.content.slice(...)` on a partial payload would blank the
 * whole dashboard.
 */
function asMemoryRecord(payload: unknown): MemoryRecord | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Partial<MemoryRecord>;
  if (typeof record.id !== 'string') return null;
  if (typeof record.content !== 'string') return null;
  if (typeof record.type !== 'string') return null;
  return record as MemoryRecord;
}

export function useWebSocket() {
  const setConnected = useNeuralStore((s) => s.setConnected);
  const addRecord = useMemoryStore((s) => s.addRecord);

  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onStored = (payload: unknown) => {
      const record = asMemoryRecord(payload);
      if (record) addRecord(record);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    // NOTE: 'neuron:activated' was subscribed here but is never emitted by the
    // server — removed rather than left as a dead listener.
    socket.on('memory:stored', onStored);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('memory:stored', onStored);
    };
  }, [setConnected, addRecord]);
}
