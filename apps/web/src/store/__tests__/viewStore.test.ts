import { describe, it, expect, vi } from 'vitest';
import { VIEWS } from '../viewStore.js';
import type { MemoryRecord } from '../memoryStore.js';

function makeRecord(id: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    type: 'semantic',
    content: `content for ${id}`,
    summary: null,
    importance: 0.5,
    source: null,
    concept: null,
    tags: '[]',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const TYPES: MemoryRecord['type'][] = ['episodic', 'semantic', 'procedural'];

function makeRecords(n: number): MemoryRecord[] {
  return Array.from({ length: n }, (_, i) =>
    makeRecord(`mem-${i}`, { type: TYPES[i % 3], importance: (i % 10) / 10 })
  );
}

function findPos(list: ReturnType<typeof VIEWS[number]['layout']>, id: string) {
  const found = list.find((p) => p.id === id);
  if (!found) throw new Error(`missing position for ${id}`);
  return { x: found.x, y: found.y, z: found.z };
}

describe('view layouts are deterministic by id (F3)', () => {
  for (const view of VIEWS) {
    describe(`${view.id} view`, () => {
      it('gives the same position for the same id across two independent calls', () => {
        const records = makeRecords(30);
        const first = view.layout(records);
        const second = view.layout(records.map((r) => ({ ...r }))); // fresh array, same content
        for (const r of records) {
          expect(findPos(second, r.id)).toEqual(findPos(first, r.id));
        }
      });

      it('does not move an existing node when an unrelated record is prepended (simulates a new memory:stored arrival)', () => {
        const records = makeRecords(20);
        const before = view.layout(records);

        const withNewArrival = [makeRecord('mem-new'), ...records];
        const after = view.layout(withNewArrival);

        for (const r of records) {
          expect(findPos(after, r.id)).toEqual(findPos(before, r.id));
        }
      });

      it('does not move remaining nodes when a record is removed (simulates an archive)', () => {
        const records = makeRecords(20);
        const before = view.layout(records);

        const afterRemoval = records.filter((r) => r.id !== 'mem-5');
        const after = view.layout(afterRemoval);

        for (const r of afterRemoval) {
          expect(findPos(after, r.id)).toEqual(findPos(before, r.id));
        }
      });

      it('does not move an existing node when another record in the array has its tags/fields edited', () => {
        const records = makeRecords(20);
        const before = view.layout(records);

        const edited = records.map((r) => (r.id === 'mem-3' ? { ...r, tags: '["urgent"]' } : r));
        const after = view.layout(edited);

        for (const r of records) {
          if (r.id === 'mem-3') continue;
          expect(findPos(after, r.id)).toEqual(findPos(before, r.id));
        }
      });

      it('spreads distinct ids across distinct positions (not a redesign — still visually spread out)', () => {
        const records = makeRecords(20);
        const positions = view.layout(records);
        const xs = new Set(positions.map((p) => Math.round(p.x * 1000)));
        expect(xs.size).toBeGreaterThan(1);
      });
    });
  }

  it('never calls Math.random — positions come from a deterministic id-derived hash, not a fresh random draw', () => {
    const spy = vi.spyOn(Math, 'random');
    const records = makeRecords(15);
    for (const view of VIEWS) {
      view.layout(records);
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
