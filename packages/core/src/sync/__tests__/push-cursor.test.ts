/**
 * Push-side cursor tests — the local (SQLite) half of sync, exercised
 * without Postgres. `drainPushBatches` + `selectMemoriesBatch` together
 * decide *which* local rows leave the device and *where the push cursor
 * lands*, and both halves have historically been wrong in ways that
 * silently stop a device pushing forever:
 *
 *   D1 — rows pulled from another device were re-selected for push, so
 *        that device's clock leaked into `lastPushAt`.
 *   D2 — page boundaries used a bare `updated_at > cursor` with no `id`
 *        tiebreak, so a group of rows sharing one timestamp was truncated
 *        at the page size.
 *
 * A fake `push` callback stands in for Postgres here: the defects are
 * entirely in the selection/cursor arithmetic, and a real server adds
 * nothing but latency to the reproduction.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { eq } from 'drizzle-orm';

import { getDb, closeDatabase } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import type { Memory, NewMemory } from '../../db/schema.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';
import { selectMemoriesBatch } from '../syncLocalReads.js';
import { drainPushBatches } from '../syncLoops.js';

const OUR_DEVICE = 'device-A';
const OTHER_DEVICE = 'device-B';
const BATCH_SIZE = 500;

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-push-cursor-'));
  dbPath = path.join(dir, 'test.db');
  process.env['ENGRAM_DB_PATH'] = dbPath;
  getDb();
});

afterEach(() => {
  closeDatabase();
  delete process.env['ENGRAM_DB_PATH'];
  cleanupTestDb(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
});

function insertMemory(id: string, deviceId: string | null, updatedAt: string): void {
  const row: NewMemory = {
    id,
    type: 'semantic',
    content: `content for ${id}`,
    embeddingDim: 384,
    importance: 0.5,
    confidence: 1.0,
    accessCount: 0,
    metadata: '{}',
    tags: '[]',
    createdAt: updatedAt,
    updatedAt,
    deviceId,
  };
  getDb().insert(schema.memories).values(row).run();
}

/** Runs one full push drain, recording every row id handed to `push`. */
async function drainPush(startCursor: string | null): Promise<{
  pushedIds: string[];
  maxUpdatedAt: string | null;
}> {
  const pushedIds: string[] = [];
  const result = await drainPushBatches<Memory>(
    (cursor) => selectMemoriesBatch(getDb(), cursor, BATCH_SIZE, OUR_DEVICE),
    (rows) => {
      for (const row of rows) pushedIds.push(row.id);
      return Promise.resolve(rows.length);
    },
    (row) => row.updatedAt,
    (row) => row.id,
    startCursor,
    BATCH_SIZE
  );
  return { pushedIds, maxUpdatedAt: result.maxUpdatedAt };
}

describe('push selection — device scoping (D1)', () => {
  it('never selects a row written by another device', async () => {
    insertMemory('mem-ours', OUR_DEVICE, '2026-01-01T12:00:00.000Z');
    insertMemory('mem-theirs', OTHER_DEVICE, '2026-01-01T12:30:00.000Z');

    const { pushedIds } = await drainPush(null);

    expect(pushedIds).toEqual(['mem-ours']);
  });

  it('still selects legacy rows that predate device attribution (device_id IS NULL)', async () => {
    insertMemory('mem-legacy', null, '2026-01-01T12:00:00.000Z');

    const { pushedIds } = await drainPush(null);

    expect(pushedIds).toEqual(['mem-legacy']);
  });

  it('selects a pulled row again once this device takes ownership of an edit', async () => {
    // The flip side of the device filter: local write paths re-stamp
    // `device_id` whenever they advance `updated_at`, so an edit to a row
    // that arrived from a peer becomes ours and pushes normally. A write
    // path that advances `updated_at` WITHOUT re-stamping `device_id` would
    // be invisible to push — see the note in syncLocalReads.ts.
    insertMemory('mem-from-b', OTHER_DEVICE, '2026-01-01T12:00:00.000Z');
    expect((await drainPush(null)).pushedIds).toEqual([]);

    getDb()
      .update(schema.memories)
      .set({ content: 'edited here', updatedAt: '2026-01-01T13:00:00.000Z', deviceId: OUR_DEVICE })
      .where(eq(schema.memories.id, 'mem-from-b'))
      .run();

    expect((await drainPush(null)).pushedIds).toEqual(['mem-from-b']);
  });

  it("a foreign row's future clock never poisons the push cursor", async () => {
    // Device B's clock runs 30 minutes ahead. B wrote M1 at 12:30 and we
    // pulled it, so it now sits in our local table stamped with B's clock.
    insertMemory('mem-b1', OTHER_DEVICE, '2026-01-01T12:30:00.000Z');

    const first = await drainPush(null);
    // The cursor must reflect OUR clock only — there is nothing of ours to
    // push yet, so it must not move at all.
    expect(first.maxUpdatedAt).toBeNull();

    // Now we write M2 at 12:05 by our own (slower) clock.
    insertMemory('mem-a2', OUR_DEVICE, '2026-01-01T12:05:00.000Z');

    const second = await drainPush(first.maxUpdatedAt);
    expect(second.pushedIds).toEqual(['mem-a2']);
    expect(second.maxUpdatedAt).toBe('2026-01-01T12:05:00.000Z');
  });
});

describe('push pagination — page-boundary timestamps (D2)', () => {
  it('pushes every row of a same-timestamp group larger than one page', async () => {
    // `DecayEngine.sweep` computes `new Date()` once and stamps every
    // decayed row with it, so a 1200-row sweep produces exactly one
    // distinct `updated_at`.
    const sweptAt = '2026-01-01T12:00:00.000Z';
    for (let i = 0; i < 1200; i++) {
      insertMemory(`mem-${String(i).padStart(4, '0')}`, OUR_DEVICE, sweptAt);
    }

    const { pushedIds } = await drainPush(null);

    expect(new Set(pushedIds).size).toBe(1200);
    expect(pushedIds).toHaveLength(1200);
  });

  it('pushes rows that share the page-boundary timestamp with rows on the next page', async () => {
    // 400 older rows fill the front of page 1; the remaining 900 all share
    // one timestamp, so page 1 ends mid-group.
    for (let i = 0; i < 400; i++) {
      insertMemory(`mem-old-${String(i).padStart(4, '0')}`, OUR_DEVICE, '2026-01-01T11:00:00.000Z');
    }
    for (let i = 0; i < 900; i++) {
      insertMemory(`mem-tie-${String(i).padStart(4, '0')}`, OUR_DEVICE, '2026-01-01T12:00:00.000Z');
    }

    const { pushedIds, maxUpdatedAt } = await drainPush(null);

    expect(new Set(pushedIds).size).toBe(1300);
    expect(maxUpdatedAt).toBe('2026-01-01T12:00:00.000Z');
  });
});
