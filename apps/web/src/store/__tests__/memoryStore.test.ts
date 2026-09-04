import { describe, it, expect, beforeEach } from 'vitest';
import { useMemoryStore, type MemoryRecord } from '../memoryStore.js';

function makeRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'mem-1',
    type: 'semantic',
    content: 'hello world',
    summary: null,
    importance: 0.5,
    source: null,
    concept: null,
    tags: '[]',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('memoryStore addRecord (F1)', () => {
  beforeEach(() => {
    useMemoryStore.setState({ records: [], totalCount: 0 });
  });

  it('inserts a brand-new record and bumps totalCount', () => {
    useMemoryStore.getState().addRecord(makeRecord());
    expect(useMemoryStore.getState().records).toHaveLength(1);
    expect(useMemoryStore.getState().totalCount).toBe(1);
  });

  it('is idempotent by id — the same record arriving twice (modal callback + socket broadcast) does not duplicate it', () => {
    const record = makeRecord();

    // Simulates StoreMemoryModal's onStored calling addRecord directly...
    useMemoryStore.getState().addRecord(record);
    // ...and the server's `memory:stored` broadcast for the same POST arriving via the socket.
    useMemoryStore.getState().addRecord(record);

    const { records, totalCount } = useMemoryStore.getState();
    expect(records).toHaveLength(1);
    expect(totalCount).toBe(1);
    expect(records.filter((r) => r.id === record.id)).toHaveLength(1);
  });

  it('is idempotent regardless of which of the two arrivals comes first', () => {
    const record = makeRecord({ id: 'mem-2' });

    // Second arrival can carry updated fields (e.g. the socket payload is the
    // authoritative DB row) — addRecord should replace, not duplicate.
    useMemoryStore.getState().addRecord(record);
    useMemoryStore.getState().addRecord({ ...record, summary: 'now summarized' });

    const { records, totalCount } = useMemoryStore.getState();
    expect(records).toHaveLength(1);
    expect(totalCount).toBe(1);
    expect(records[0]?.summary).toBe('now summarized');
  });

  it('still prepends distinct records normally', () => {
    useMemoryStore.getState().addRecord(makeRecord({ id: 'a' }));
    useMemoryStore.getState().addRecord(makeRecord({ id: 'b' }));

    const { records, totalCount } = useMemoryStore.getState();
    expect(records.map((r) => r.id)).toEqual(['b', 'a']);
    expect(totalCount).toBe(2);
  });
});
