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
    useMemoryStore.setState({ records: [], loadedCount: 0 });
  });

  it('inserts a brand-new record and bumps the loaded-page count', () => {
    useMemoryStore.getState().addRecord(makeRecord());
    expect(useMemoryStore.getState().records).toHaveLength(1);
    expect(useMemoryStore.getState().loadedCount).toBe(1);
  });

  it('is idempotent by id — the same record arriving twice (modal callback + socket broadcast) does not duplicate it', () => {
    const record = makeRecord();

    // Simulates StoreMemoryModal's onStored calling addRecord directly...
    useMemoryStore.getState().addRecord(record);
    // ...and the server's `memory:stored` broadcast for the same POST arriving via the socket.
    useMemoryStore.getState().addRecord(record);

    const { records, loadedCount } = useMemoryStore.getState();
    expect(records).toHaveLength(1);
    expect(loadedCount).toBe(1);
    expect(records.filter((r) => r.id === record.id)).toHaveLength(1);
  });

  it('is idempotent regardless of which of the two arrivals comes first', () => {
    const record = makeRecord({ id: 'mem-2' });

    // Second arrival can carry updated fields (e.g. the socket payload is the
    // authoritative DB row) — addRecord should replace, not duplicate.
    useMemoryStore.getState().addRecord(record);
    useMemoryStore.getState().addRecord({ ...record, summary: 'now summarized' });

    const { records, loadedCount } = useMemoryStore.getState();
    expect(records).toHaveLength(1);
    expect(loadedCount).toBe(1);
    expect(records[0]?.summary).toBe('now summarized');
  });

  it('still prepends distinct records normally', () => {
    useMemoryStore.getState().addRecord(makeRecord({ id: 'a' }));
    useMemoryStore.getState().addRecord(makeRecord({ id: 'b' }));

    const { records, loadedCount } = useMemoryStore.getState();
    expect(records.map((r) => r.id)).toEqual(['b', 'a']);
    expect(loadedCount).toBe(2);
  });
});

describe('memoryStore addRecord under a project filter', () => {
  beforeEach(() => {
    useMemoryStore.setState({ records: [], loadedCount: 0, storeChanges: 0, projectFilter: undefined });
  });

  it('keeps an arrival from another project out of a filtered list, but still counts the store change', () => {
    useMemoryStore.setState({ projectFilter: '/code/api' });
    useMemoryStore.getState().addRecord(makeRecord({ id: 'web', namespace: '/code/web' }));
    useMemoryStore.getState().addRecord(makeRecord({ id: 'global', namespace: null }));
    useMemoryStore.getState().addRecord(makeRecord({ id: 'api', namespace: '/code/api' }));
    const { records, storeChanges } = useMemoryStore.getState();
    expect(records.map((r) => r.id)).toEqual(['api']);
    expect(storeChanges).toBe(3);
  });

  it('lets a global arrival (null or no namespace) into the Global list', () => {
    useMemoryStore.setState({ projectFilter: null });
    useMemoryStore.getState().addRecord(makeRecord({ id: 'a' }));
    useMemoryStore.getState().addRecord(makeRecord({ id: 'b', namespace: null }));
    useMemoryStore.getState().addRecord(makeRecord({ id: 'c', namespace: '/code/api' }));
    expect(useMemoryStore.getState().records.map((r) => r.id)).toEqual(['b', 'a']);
  });
});
