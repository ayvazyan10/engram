/**
 * GET /api/analytics — the honesty properties of the payload.
 *
 * A data-visualisation review found this endpoint telling readers things that
 * were not true: the growth series skipped days entirely (23 points across 28
 * calendar days), so a client plotting it on a category axis drew a two-day
 * gap the same width as a one-day step and splined through the hole; and one
 * response mixed two time windows with nothing saying which was which
 * (sum(dailyGrowth) == 87 sitting beside total == 651).
 *
 * These tests pin the properties that fix those, because they are exactly the
 * properties that break silently: nothing throws when a day goes missing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import type { FastifyInstance } from 'fastify';
import { getDb, schema } from '@engram-ai-memory/core';
import { eq, notInArray, sql } from 'drizzle-orm';
import { cleanupTestDb } from '../test-helpers/cleanupTestDb.js';
import {
  buildWindow,
  clampDays,
  enumerateDays,
  fillDailyGrowth,
  foldCounts,
  weekdayCoverage,
  MAX_WINDOW_DAYS,
  MIN_WINDOW_DAYS,
} from '../lib/analyticsWindow.js';

const DAY_MS = 86_400_000;
/** Start of the current UTC day — the same anchor the route uses. */
const TODAY_UTC = Math.floor(Date.now() / DAY_MS) * DAY_MS;

/** `YYYY-MM-DD`, `offset` whole days before today (UTC). */
function dayIso(offset: number): string {
  return new Date(TODAY_UTC - offset * DAY_MS).toISOString().slice(0, 10);
}

/** An instant inside the UTC day `offset` days before today. */
function instant(offset: number, hour = 12): string {
  return new Date(TODAY_UTC - offset * DAY_MS + hour * 3_600_000).toISOString();
}

describe('analytics window helpers', () => {
  it('builds a day-aligned window with exactly `days` days, ending today', () => {
    const win = buildWindow(7, new Date(TODAY_UTC + 5 * 3_600_000));

    expect(win.days).toBe(7);
    expect(win.start).toBe(dayIso(6));
    expect(win.end).toBe(dayIso(0));
    // Half-open [startedAt, endsBefore): midnight to midnight, so the series
    // is `days` long instead of the 31 partial buckets a rolling
    // `now - days * 24h` bound produced.
    expect(win.startedAt).toBe(new Date(TODAY_UTC - 6 * DAY_MS).toISOString());
    expect(win.endsBefore).toBe(new Date(TODAY_UTC + DAY_MS).toISOString());
    expect(win.timezone).toBe('UTC');
    expect(enumerateDays(win)).toHaveLength(7);
  });

  it('clamps days so no caller can turn it into an unbounded scan', () => {
    expect(clampDays(0)).toBe(MIN_WINDOW_DAYS);
    expect(clampDays(-5)).toBe(MIN_WINDOW_DAYS);
    expect(clampDays(10_000)).toBe(MAX_WINDOW_DAYS);
    expect(clampDays(Number.NaN)).toBe(30);
    expect(clampDays(undefined)).toBe(30);
    expect(clampDays(7.9)).toBe(7);
    expect(buildWindow(10_000).days).toBe(MAX_WINDOW_DAYS);
  });

  it('zero-fills a deliberate gap instead of dropping the days', () => {
    const win = buildWindow(5, new Date(TODAY_UTC));
    // Days -4 and -1 have rows; -3, -2 and today do not. SQL returns three
    // rows; the reader must get five points.
    const rows = [
      { date: dayIso(4), count: 2 },
      { date: dayIso(1), count: 3 },
    ];

    const filled = fillDailyGrowth(rows, win, 10);

    expect(filled.map((p) => p.date)).toEqual([
      dayIso(4), dayIso(3), dayIso(2), dayIso(1), dayIso(0),
    ]);
    expect(filled.map((p) => p.count)).toEqual([2, 0, 0, 3, 0]);
    // cumulative carries the pre-window store size forward and never dips.
    expect(filled.map((p) => p.cumulative)).toEqual([12, 12, 12, 15, 15]);
  });

  it('drops rows outside the window rather than mis-dating them', () => {
    const win = buildWindow(3, new Date(TODAY_UTC));
    const filled = fillDailyGrowth(
      [{ date: dayIso(99), count: 9 }, { date: null, count: 4 }],
      win,
      0
    );

    expect(filled).toHaveLength(3);
    expect(filled.every((p) => p.count === 0)).toBe(true);
  });

  it('reports weekday coverage so a heatmap can be read as a rate', () => {
    // Anchored to fixed dates, and to a window whose weekdays are NOT all
    // equal: 2026-01-03 is a Saturday(6), 01-04 a Sunday(0), 01-05 a Monday(1).
    // A rotation of the array — getDay() instead of getUTCDay(), or an
    // off-by-one against SQLite's strftime('%w') — has to fail this, which a
    // length-and-sum check or an all-ones 7-day window cannot do.
    expect(weekdayCoverage(buildWindow(3, new Date('2026-01-05T12:00:00.000Z')))).toEqual([
      1, 1, 0, 0, 0, 0, 1,
    ]);
    // Ten days ending Monday 2026-01-05: two Sundays and two Mondays, one each
    // of the rest.
    expect(weekdayCoverage(buildWindow(10, new Date('2026-01-05T12:00:00.000Z')))).toEqual([
      2, 2, 1, 1, 1, 1, 2,
    ]);

    // A 30-day window holds five of some weekdays and four of others; raw
    // per-weekday counts make the extra day look ~25% busier.
    const coverage = weekdayCoverage(buildWindow(30, new Date(TODAY_UTC)));
    expect(coverage.reduce((a, b) => a + b, 0)).toBe(30);
    expect(coverage.every((c) => c === 4 || c === 5)).toBe(true);
  });

  it('treats a NULL count as zero rather than producing NaN', () => {
    // The driver types say `number`; SQLite aggregates can still hand back
    // NULL. A NaN here would render as a blank point in the middle of a line
    // chart, which reads as "no data" rather than "we broke".
    const nullCount = null as unknown as number;
    const win = buildWindow(2, new Date(TODAY_UTC));

    expect(fillDailyGrowth([{ date: dayIso(1), count: nullCount }], win, 3)).toEqual([
      { date: dayIso(1), count: 0, cumulative: 3 },
      { date: dayIso(0), count: 0, cumulative: 3 },
    ]);
    expect(foldCounts([{ key: 'cli', count: nullCount }])).toEqual({ cli: 0 });
  });

  it('sums NULL into the fallback bucket instead of overwriting it', () => {
    // Object.fromEntries would keep only the last of these two groups, and the
    // breakdown would stop summing to the total printed beside it.
    const folded = foldCounts([
      { key: null, count: 3 },
      { key: 'unknown', count: 4 },
      { key: 'cli', count: 5 },
    ]);

    expect(folded).toEqual({ unknown: 7, cli: 5 });
  });
});

const dbPath = path.join(os.tmpdir(), `engram-analytics-test-${Date.now()}.db`);

let app: FastifyInstance;
let brain: typeof import('../index.js')['brain'];

/** Ids of the memories that make up the shaped 7-day dataset. */
const windowIds: string[] = [];

async function storeMemory(content: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/memory',
    payload: { content, type: 'semantic', source: 'analytics-test', importance: 0.6, ...extra },
  });
  expect(res.statusCode).toBe(201);
  return res.json().memory.id as string;
}

/** Move a stored memory onto a chosen UTC day. */
async function backdate(id: string, createdAt: string): Promise<void> {
  await getDb().update(schema.memories).set({ createdAt }).where(eq(schema.memories.id, id));
}

/**
 * Retire a memory a test added, through the API that archives it.
 *
 * Not a raw DELETE: the vector index would keep the id, and the next store
 * builds graph edges to whatever the index returns — which fails the
 * memories foreign key and 500s the following test. Archiving is what
 * forget() does, and archived rows are excluded from every scope here, so the
 * fixture's counts are restored either way.
 */
async function retire(id: string): Promise<void> {
  const res = await app.inject({ method: 'DELETE', url: `/api/memory/${id}` });
  expect(res.statusCode).toBe(204);
}

beforeAll(async () => {
  process.env['ENGRAM_DB_PATH'] = dbPath;
  process.env['ENGRAM_DECAY_INTERVAL'] = '0';

  const mod = await import('../index.js');
  brain = mod.brain;
  await brain.initialize();
  app = await mod.buildApp();
  await app.ready();

  // Dataset shaped for a 7-day window, with holes on purpose:
  //   D-6: 2   D-5: 0   D-4: 0   D-3: 1   D-2: 0   D-1: 2   D-0: 0
  const plan: Array<{ offset: number; hour: number; concept: string; source: string }> = [
    { offset: 6, hour: 3, concept: 'alpha', source: 'cli' },
    { offset: 6, hour: 4, concept: 'alpha', source: 'cli' },
    { offset: 3, hour: 9, concept: 'beta', source: 'mcp' },
    { offset: 1, hour: 10, concept: 'alpha', source: 'mcp' },
    { offset: 1, hour: 11, concept: 'gamma', source: 'cli' },
  ];

  for (const [i, row] of plan.entries()) {
    windowIds.push(
      await storeMemory(`windowed memory ${i}`, { concept: row.concept, source: row.source })
    );
  }
  // One memory that predates the window, so allTime and windowed must differ.
  const oldId = await storeMemory('an older memory', { concept: 'delta', source: 'legacy' });

  // Push anything the brain may have written of its own accord (a
  // consolidation, a link) well outside the window, so only the planned rows
  // land inside it.
  await getDb()
    .update(schema.memories)
    .set({ createdAt: instant(200, 6) })
    .where(notInArray(schema.memories.id, [...windowIds, oldId]));
  await backdate(oldId, instant(100, 6));

  for (const [i, row] of plan.entries()) {
    await backdate(windowIds[i] as string, instant(row.offset, row.hour));
  }

  // The all-time assertions below (total 6, conceptCount 4, sourceCount 3)
  // need more than "extras are outside the window" — they need there to be no
  // extras at all, since allTime sees those too. Pin it here rather than
  // letting three tests fail confusingly if that ever changes.
  const [rows] = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(schema.memories);
  expect(rows?.count, 'the fixture must be the only rows in the store').toBe(plan.length + 1);
});

afterAll(async () => {
  await app?.close();
  try { brain?.shutdown(); } catch { /* best effort */ }
  cleanupTestDb(dbPath);
});

async function analytics(query = '?days=7') {
  const res = await app.inject({ method: 'GET', url: `/api/analytics${query}` });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('GET /api/analytics — growth series', () => {
  it('returns one point per day across the whole window, zeros included', async () => {
    const body = await analytics();

    expect(body.window.days).toBe(7);
    expect(body.window.start).toBe(dayIso(6));
    expect(body.window.end).toBe(dayIso(0));
    // The defect: 23 points for 28 calendar days. There must be exactly one
    // point per requested day, in order, with no day missing.
    expect(body.windowed.dailyGrowth).toHaveLength(7);
    expect(body.windowed.dailyGrowth.map((p: { date: string }) => p.date)).toEqual([
      dayIso(6), dayIso(5), dayIso(4), dayIso(3), dayIso(2), dayIso(1), dayIso(0),
    ]);
    expect(body.windowed.dailyGrowth.map((p: { count: number }) => p.count)).toEqual([
      2, 0, 0, 1, 0, 2, 0,
    ]);
  });

  it('keeps `count` as new-per-day and offers `cumulative` as the running total', async () => {
    const body = await analytics();
    const series = body.windowed.dailyGrowth as Array<{ count: number; cumulative: number }>;

    expect(body.windowed.baseline).toBe(body.allTime.total - body.windowed.total);
    // cumulative is seeded by the store size at the window's open, so it is the
    // real total over time — not a count that restarts whenever the window moves.
    expect(series[0]?.cumulative).toBe(body.windowed.baseline + (series[0]?.count ?? 0));
    expect(series.at(-1)?.cumulative).toBe(body.allTime.total);
    expect(series.map((p) => p.cumulative)).toEqual(
      series.map((_, i) =>
        body.windowed.baseline + series.slice(0, i + 1).reduce((a, p) => a + p.count, 0)
      )
    );
  });

  it("counts a SQLite-formatted timestamp on the window's first day", async () => {
    // created_at is TEXT and the window filter is a string comparison. Every
    // writer here stamps ISO, but SQLite's CURRENT_TIMESTAMP default writes
    // '2026-08-06 12:00:00' — and ' ' < 'T', so an instant bound would drop
    // this row into the baseline while date() still bucketed it on day one.
    const id = await storeMemory('a memory stamped the SQLite way');
    await backdate(id, `${dayIso(6)} 12:00:00`);

    try {
      const body = await analytics();
      const first = body.windowed.dailyGrowth[0];

      expect(first.date).toBe(dayIso(6));
      expect(first.count).toBe(3); // the two planned rows plus this one
      expect(body.windowed.total).toBe(6);
      expect(body.windowed.baseline).toBe(body.allTime.total - body.windowed.total);
      expect(
        body.windowed.dailyGrowth.reduce((a: number, p: { count: number }) => a + p.count, 0)
      ).toBe(body.windowed.total);
    } finally {
      await retire(id);
    }
  });

  it('buckets an offset-suffixed timestamp on the day the filter admitted it', async () => {
    // The filter is a prefix compare, so this row is inside the window. A
    // bucket that re-parses the timestamp disagrees: date() normalises
    // '+05:00' to the previous UTC day, which is outside the window entirely,
    // and the row would be counted in windowed.total while appearing on no
    // day at all. Bucketing on the same prefix the filter uses makes the two
    // unable to disagree, whatever the writer stamped.
    const id = await storeMemory('a memory stamped with a UTC offset');
    await backdate(id, `${dayIso(6)}T01:00:00+05:00`);

    try {
      const body = await analytics();

      expect(body.windowed.total).toBe(6);
      expect(
        body.windowed.dailyGrowth.reduce((a: number, p: { count: number }) => a + p.count, 0)
      ).toBe(body.windowed.total);
      expect(body.windowed.dailyGrowth[0]).toMatchObject({ date: dayIso(6), count: 3 });
    } finally {
      await retire(id);
    }
  });

  it('excludes clock-skewed future rows so the series still sums to the total', async () => {
    const id = await storeMemory('a memory dated in the future');
    await backdate(id, new Date(TODAY_UTC + 2 * DAY_MS).toISOString());

    try {
      const body = await analytics();
      const summed = body.windowed.dailyGrowth.reduce(
        (a: number, p: { count: number }) => a + p.count, 0
      );

      expect(summed).toBe(body.windowed.total);
      expect(body.windowed.total).toBe(5);
      // It still exists, so all-time counts it.
      expect(body.allTime.total).toBe(7);
    } finally {
      await retire(id);
    }
  });
});

describe('GET /api/analytics — scope', () => {
  it('agrees with itself: every windowed aggregate sums to windowed.total', async () => {
    const body = await analytics();
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

    // The defect: dailyGrowth and hourlyActivity summed to 87 while `total`,
    // byType and bySource in the same payload described 651.
    expect(body.windowed.total).toBe(5);
    expect(sum(body.windowed.byType)).toBe(5);
    expect(sum(body.windowed.bySource)).toBe(5);
    expect(
      body.windowed.dailyGrowth.reduce((a: number, p: { count: number }) => a + p.count, 0)
    ).toBe(5);
    expect(
      body.windowed.hourlyActivity.reduce((a: number, c: { count: number }) => a + c.count, 0)
    ).toBe(5);
  });

  it('states the window, and puts unwindowed numbers under a key that says so', async () => {
    const body = await analytics();

    expect(Object.keys(body).sort()).toEqual([
      'allTime', 'excludesArchived', 'window', 'windowed',
    ]);
    // Archival is silent in every other number here — including in the past
    // days of the growth series, where a memory archived this morning is
    // missing from the day it was created. The payload has to say so.
    expect(body.excludesArchived).toBe(true);
    expect(body.window).toMatchObject({
      days: 7,
      timezone: 'UTC',
      start: dayIso(6),
      end: dayIso(0),
    });
    expect(typeof body.window.generatedAt).toBe('string');
    expect(body.window.endsBefore).toBe(new Date(TODAY_UTC + DAY_MS).toISOString());
    // 6 memories exist; 5 of them fall in the window. Both numbers are
    // present, and neither can be mistaken for the other.
    expect(body.allTime.total).toBe(6);
    expect(body.windowed.total).toBe(5);
  });

  it('reports null, not 0, for the average importance of an empty window', async () => {
    // Nothing was created today, so days=1 is an empty scope. A 0 average
    // would read as "these memories are all unimportant".
    const body = await analytics('?days=1');

    expect(body.windowed.total).toBe(0);
    expect(body.windowed.avgImportance).toBeNull();
    expect(body.windowed.dailyGrowth).toEqual([
      { date: dayIso(0), count: 0, cumulative: 6 },
    ]);
    expect(body.windowed.byType).toEqual({});
    expect(body.windowed.topConcepts).toEqual([]);
    expect(body.windowed.conceptCount).toBe(0);
    // all-time still has data, and still says so.
    expect(body.allTime.total).toBe(6);
    expect(body.allTime.avgImportance).toBeGreaterThan(0);
  });
});

describe('GET /api/analytics — counts vs page sizes', () => {
  it('returns a real concept count beside the bounded top-N list', async () => {
    const body = await analytics();

    // topConcepts.length is a page size: it reads 20 whether the store holds
    // 20 concepts or 2,000. conceptCount is the statistic.
    expect(body.windowed.topConceptsLimit).toBe(20);
    expect(body.windowed.topConcepts.length).toBeLessThanOrEqual(20);
    expect(body.windowed.conceptCount).toBe(3); // alpha, beta, gamma
    expect(body.allTime.conceptCount).toBe(4); // + delta, outside the window
    expect(body.windowed.topConcepts[0]).toMatchObject({ concept: 'alpha', count: 3 });
  });

  it('ranks concepts in a stable order so a re-fetch does not reshuffle', async () => {
    // beta and gamma both have one memory. Without a tiebreak SQLite may
    // return tied rows in either order, and a dashboard polling on a timer
    // reorders its bars with no data having changed.
    const first = await analytics();
    const second = await analytics();
    const names = (b: { windowed: { topConcepts: Array<{ concept: string }> } }) =>
      b.windowed.topConcepts.map((c) => c.concept);

    expect(names(first)).toEqual(['alpha', 'beta', 'gamma']);
    expect(names(second)).toEqual(names(first));
  });

  it('returns a source count that matches the complete bySource breakdown', async () => {
    const body = await analytics();

    expect(Object.keys(body.windowed.bySource).sort()).toEqual(['cli', 'mcp']);
    expect(body.windowed.sourceCount).toBe(Object.keys(body.windowed.bySource).length);
    // all-time sees the legacy source too, so a client slicing a chart to the
    // top N can say "2 of 3" without recomputing anything.
    expect(body.allTime.sourceCount).toBe(3);
  });

  it('places heatmap cells on the hour and weekday the memory was written', async () => {
    const body = await analytics();
    const cells = body.windowed.hourlyActivity as Array<{
      hour: number; dayOfWeek: number; count: number;
    }>;
    const dow = (offset: number) => new Date(`${dayIso(offset)}T00:00:00.000Z`).getUTCDay();

    // The fixture planted memories at known UTC hours: D-6 at 03 and 04, D-3
    // at 09, D-1 at 10 and 11. Asserting the cells themselves is what ties
    // strftime('%w') to the weekday indices weekdayCoverage uses; a range
    // check over an empty array proves nothing.
    expect(cells).toHaveLength(5);
    expect(cells).toContainEqual({ hour: 3, dayOfWeek: dow(6), count: 1 });
    expect(cells).toContainEqual({ hour: 4, dayOfWeek: dow(6), count: 1 });
    expect(cells).toContainEqual({ hour: 9, dayOfWeek: dow(3), count: 1 });
    expect(cells).toContainEqual({ hour: 11, dayOfWeek: dow(1), count: 1 });

    // Coverage is indexed the same way, so the cell's weekday can be used to
    // divide by it.
    const coverage = body.windowed.weekdayCoverage as number[];
    expect(coverage).toHaveLength(7);
    expect(coverage.reduce((a, b) => a + b, 0)).toBe(7);
    expect(coverage[dow(6)]).toBe(1);
  });
});

describe('GET /api/analytics — querystring bounds', () => {
  it('rejects junk, out-of-range and non-integer days', async () => {
    for (const q of ['?days=abc', '?days=0', '?days=366', '?days=100000', '?days=1.5', '?days=-1']) {
      const res = await app.inject({ method: 'GET', url: `/api/analytics${q}` });
      expect(res.statusCode, `expected 400 for ${q}`).toBe(400);
    }
  });

  it('rejects unknown query parameters instead of silently ignoring them', async () => {
    // ?day=90 used to be answered with a 30-day window the caller believed
    // was 90 — the same quiet lie as the mixed scopes.
    const res = await app.inject({ method: 'GET', url: '/api/analytics?day=90' });
    expect(res.statusCode).toBe(400);
    // Not toContain('day') — that matches the substring inside 'days' and
    // would pass even if the hook named the wrong parameter.
    expect(res.json().message).toContain('Unknown query parameter: day.');

    const several = await app.inject({ method: 'GET', url: '/api/analytics?days=7&foo=1&bar=2' });
    expect(several.statusCode).toBe(400);
    expect(several.json().message).toContain('foo, bar');
  });

  it('defaults to a 30-day window', async () => {
    const body = await analytics('');
    expect(body.window.days).toBe(30);
    expect(body.windowed.dailyGrowth).toHaveLength(30);
  });
});
