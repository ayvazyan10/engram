/**
 * Unit tests for conflict.ts — pure functions, no database.
 *
 * See `.claude/PRPs/plans/postgres-cloud-sync.md` (section 4) for the
 * resolution rules under test.
 */

import { describe, it, expect } from 'vitest';
import {
  compareLWW,
  resolveMemoryConflict,
  resolveConnectionConflict,
  resolveSessionConflict,
  shouldApplyPulledRow,
} from '../conflict.js';
import type { Memory, MemoryConnection, Session } from '../../db/schema.js';
import type { PgMemory, PgMemoryConnection, PgSession } from '../../db/pg/schema.js';

// ─── fixtures ───────────────────────────────────────────────────────────────

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-1',
    type: 'semantic',
    content: 'local content',
    summary: null,
    embedding: null,
    embeddingDim: 384,
    embeddingModel: null,
    importance: 0.5,
    confidence: 1.0,
    accessCount: 0,
    lastAccessedAt: null,
    eventAt: null,
    sessionId: null,
    source: null,
    concept: null,
    triggerPattern: null,
    actionPattern: null,
    namespace: null,
    metadata: '{}',
    tags: '[]',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    deviceId: 'device-aaa',
    ...overrides,
  };
}

function makePgMemory(overrides: Partial<PgMemory> = {}): PgMemory {
  const { ...memoryOverrides } = overrides;
  const base = makeMemory(memoryOverrides as Partial<Memory>);
  return {
    ...base,
    content: overrides.content ?? 'remote content',
    serverUpdatedAt: new Date('2026-01-01T00:00:05.000Z'),
    ...overrides,
  };
}

function makeConnection(overrides: Partial<MemoryConnection> = {}): MemoryConnection {
  return {
    id: 'conn-1',
    sourceId: 'mem-1',
    targetId: 'mem-2',
    relationship: 'relates_to',
    strength: 1.0,
    bidirectional: false,
    metadata: '{}',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    deviceId: 'device-aaa',
    ...overrides,
  };
}

function makePgConnection(overrides: Partial<PgMemoryConnection> = {}): PgMemoryConnection {
  const base = makeConnection(overrides as Partial<MemoryConnection>);
  return {
    ...base,
    serverUpdatedAt: new Date('2026-01-01T00:00:05.000Z'),
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    source: 'claude-code',
    context: null,
    namespace: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    deviceId: 'device-aaa',
    ...overrides,
  };
}

function makePgSession(overrides: Partial<PgSession> = {}): PgSession {
  const base = makeSession(overrides as Partial<Session>);
  return {
    ...base,
    serverUpdatedAt: new Date('2026-01-01T00:00:05.000Z'),
    ...overrides,
  };
}

// ─── compareLWW ─────────────────────────────────────────────────────────────

describe('compareLWW', () => {
  it('later timestamp wins', () => {
    const result = compareLWW(
      '2026-01-02T00:00:00.000Z',
      'device-a',
      '2026-01-01T00:00:00.000Z',
      'device-b',
    );
    expect(result).toBeGreaterThan(0);

    const reversed = compareLWW(
      '2026-01-01T00:00:00.000Z',
      'device-a',
      '2026-01-02T00:00:00.000Z',
      'device-b',
    );
    expect(reversed).toBeLessThan(0);
  });

  it('identical timestamps: greater device_id wins', () => {
    const aGreater = compareLWW(
      '2026-01-01T00:00:00.000Z',
      'device-z',
      '2026-01-01T00:00:00.000Z',
      'device-a',
    );
    expect(aGreater).toBeGreaterThan(0);

    const bGreater = compareLWW(
      '2026-01-01T00:00:00.000Z',
      'device-a',
      '2026-01-01T00:00:00.000Z',
      'device-z',
    );
    expect(bGreater).toBeLessThan(0);
  });

  it('null updated_at loses to non-null', () => {
    const aNull = compareLWW(null, 'device-a', '2026-01-01T00:00:00.000Z', 'device-b');
    expect(aNull).toBeLessThan(0);

    const bNull = compareLWW('2026-01-01T00:00:00.000Z', 'device-a', null, 'device-b');
    expect(bNull).toBeGreaterThan(0);
  });

  it('both timestamps null: device_id breaks the tie', () => {
    const aGreater = compareLWW(null, 'device-z', null, 'device-a');
    expect(aGreater).toBeGreaterThan(0);

    const bGreater = compareLWW(null, 'device-a', null, 'device-z');
    expect(bGreater).toBeLessThan(0);

    const bothNull = compareLWW(null, null, null, null);
    expect(bothNull).toBe(0);
  });
});

// ─── resolveMemoryConflict ──────────────────────────────────────────────────

describe('resolveMemoryConflict', () => {
  it('remote is newer → remote wins', () => {
    const local = makeMemory({ updatedAt: '2026-01-01T00:00:00.000Z', deviceId: 'device-a' });
    const remote = makePgMemory({ updatedAt: '2026-01-02T00:00:00.000Z', deviceId: 'device-b' });

    const result = resolveMemoryConflict(local, remote);

    expect(result.winner).toBe('remote');
    expect(result.reason).toBe('lww:updated_at');
    expect(result.merged.content).toBe(remote.content);
  });

  it('local is newer → local wins', () => {
    const local = makeMemory({ updatedAt: '2026-01-02T00:00:00.000Z', deviceId: 'device-a' });
    const remote = makePgMemory({ updatedAt: '2026-01-01T00:00:00.000Z', deviceId: 'device-b' });

    const result = resolveMemoryConflict(local, remote);

    expect(result.winner).toBe('local');
    expect(result.reason).toBe('lww:updated_at');
    expect(result.merged.content).toBe(local.content);
  });

  it('same updated_at → device_id tiebreak', () => {
    const sameTimestamp = '2026-01-01T00:00:00.000Z';
    const local = makeMemory({ updatedAt: sameTimestamp, deviceId: 'device-aaa' });
    const remote = makePgMemory({ updatedAt: sameTimestamp, deviceId: 'device-zzz' });

    const result = resolveMemoryConflict(local, remote);

    expect(result.winner).toBe('remote'); // 'zzz' > 'aaa'
    expect(result.reason).toBe('lww:device_id_tiebreak');
    expect(result.merged.content).toBe(remote.content);
  });

  it('access_count is MAX\'d regardless of winner', () => {
    const local = makeMemory({
      updatedAt: '2026-01-02T00:00:00.000Z', // local wins
      accessCount: 3,
    });
    const remote = makePgMemory({
      updatedAt: '2026-01-01T00:00:00.000Z',
      accessCount: 10,
    });

    const result = resolveMemoryConflict(local, remote);

    expect(result.winner).toBe('local');
    expect(result.merged.accessCount).toBe(10);

    // And the reverse: remote wins the row, local still had the higher count.
    const local2 = makeMemory({ updatedAt: '2026-01-01T00:00:00.000Z', accessCount: 99 });
    const remote2 = makePgMemory({ updatedAt: '2026-01-02T00:00:00.000Z', accessCount: 1 });
    const result2 = resolveMemoryConflict(local2, remote2);

    expect(result2.winner).toBe('remote');
    expect(result2.merged.accessCount).toBe(99);
  });

  it('last_accessed_at is MAX\'d', () => {
    const local = makeMemory({
      updatedAt: '2026-01-02T00:00:00.000Z',
      lastAccessedAt: '2026-01-05T00:00:00.000Z',
    });
    const remote = makePgMemory({
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastAccessedAt: '2026-01-09T00:00:00.000Z',
    });

    const result = resolveMemoryConflict(local, remote);

    expect(result.merged.lastAccessedAt).toBe('2026-01-09T00:00:00.000Z');
  });

  it('a true tie on updated_at/device_id resolves via access-count reason', () => {
    const local = makeMemory({
      updatedAt: '2026-01-01T00:00:00.000Z',
      deviceId: 'device-a',
      accessCount: 2,
      lastAccessedAt: '2026-01-01T00:00:00.000Z',
    });
    const remote = makePgMemory({
      updatedAt: '2026-01-01T00:00:00.000Z',
      deviceId: 'device-a',
      accessCount: 5,
      lastAccessedAt: '2026-01-02T00:00:00.000Z',
    });

    const result = resolveMemoryConflict(local, remote);

    expect(result.reason).toBe('max:access_count');
    expect(result.merged.accessCount).toBe(5);
    expect(result.merged.lastAccessedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('archived (deleted) memory wins when the deletion is newer', () => {
    const local = makeMemory({
      updatedAt: '2026-01-01T00:00:00.000Z',
      archivedAt: null,
      content: 'still here',
    });
    const remote = makePgMemory({
      updatedAt: '2026-01-01T00:00:00.000Z', // edit no newer than local's own edit
      archivedAt: '2026-01-03T00:00:00.000Z', // but archived well after
      content: 'archived elsewhere',
    });

    const result = resolveMemoryConflict(local, remote);

    expect(result.winner).toBe('remote');
    expect(result.merged.archivedAt).toBe('2026-01-03T00:00:00.000Z');
  });

  it('edit wins when it is newer than a stale deletion', () => {
    const local = makeMemory({
      updatedAt: '2026-01-05T00:00:00.000Z', // re-edited after the old archival
      archivedAt: null,
      content: 'revived and edited',
    });
    const remote = makePgMemory({
      updatedAt: '2026-01-01T00:00:00.000Z',
      archivedAt: '2026-01-02T00:00:00.000Z', // older than local's edit
      content: 'stale archived copy',
    });

    const result = resolveMemoryConflict(local, remote);

    expect(result.winner).toBe('local');
    expect(result.merged.content).toBe('revived and edited');
  });

  it('never mutates its inputs', () => {
    const local = makeMemory({ updatedAt: '2026-01-01T00:00:00.000Z', accessCount: 1 });
    const remote = makePgMemory({ updatedAt: '2026-01-02T00:00:00.000Z', accessCount: 2 });
    const localSnapshot = { ...local };
    const remoteSnapshot = { ...remote };

    resolveMemoryConflict(local, remote);

    expect(local).toEqual(localSnapshot);
    expect(remote).toEqual(remoteSnapshot);
  });
});

// ─── resolveConnectionConflict ──────────────────────────────────────────────

describe('resolveConnectionConflict', () => {
  it('basic LWW: newer side wins', () => {
    const local = makeConnection({ updatedAt: '2026-01-01T00:00:00.000Z', strength: 0.5 });
    const remote = makePgConnection({ updatedAt: '2026-01-02T00:00:00.000Z', strength: 0.9 });

    const result = resolveConnectionConflict(local, remote);

    expect(result.winner).toBe('remote');
    expect(result.merged.strength).toBe(0.9);
  });

  it('a tombstoned (deleted) connection wins when the deletion is newer', () => {
    const local = makeConnection({
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
    });
    const remote = makePgConnection({
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: '2026-01-04T00:00:00.000Z',
    });

    const result = resolveConnectionConflict(local, remote);

    expect(result.winner).toBe('remote');
    expect(result.merged.deletedAt).toBe('2026-01-04T00:00:00.000Z');
  });

  it('null updated_at on one side loses to the other side', () => {
    const local = makeConnection({ updatedAt: null, deviceId: null });
    const remote = makePgConnection({ updatedAt: '2026-01-01T00:00:00.000Z' });

    const result = resolveConnectionConflict(local, remote);

    expect(result.winner).toBe('remote');
  });
});

// ─── resolveSessionConflict ─────────────────────────────────────────────────

describe('resolveSessionConflict', () => {
  it('basic LWW: newer side wins', () => {
    const local = makeSession({ updatedAt: '2026-01-02T00:00:00.000Z', context: 'local-ctx' });
    const remote = makePgSession({ updatedAt: '2026-01-01T00:00:00.000Z', context: 'remote-ctx' });

    const result = resolveSessionConflict(local, remote);

    expect(result.winner).toBe('local');
    expect(result.merged.context).toBe('local-ctx');
  });

  it('deletion wins when newer than the other side\'s edit', () => {
    const local = makeSession({ updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null });
    const remote = makePgSession({
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: '2026-01-03T00:00:00.000Z',
    });

    const result = resolveSessionConflict(local, remote);

    expect(result.winner).toBe('remote');
    expect(result.merged.deletedAt).toBe('2026-01-03T00:00:00.000Z');
  });
});

// ─── shouldApplyPulledRow ───────────────────────────────────────────────────

describe('shouldApplyPulledRow', () => {
  it('skips a row whose device_id matches ours (echo of our own push)', () => {
    expect(shouldApplyPulledRow('device-aaa', 'device-aaa')).toBe(false);
  });

  it('applies a row from a different device', () => {
    expect(shouldApplyPulledRow('device-bbb', 'device-aaa')).toBe(true);
  });

  it('applies a row with a null device_id (origin unknown, don\'t drop it)', () => {
    expect(shouldApplyPulledRow(null, 'device-aaa')).toBe(true);
  });
});
