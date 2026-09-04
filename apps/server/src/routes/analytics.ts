import type { FastifyPluginAsync } from 'fastify';
import { getDb, getDeviceId, schema, embed, packFP16 } from '@engram-ai-memory/core';
import type { MemoryType } from '@engram-ai-memory/core';
import { isNull, and, eq, inArray, sql, gte, lt, desc } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { brain, notifySyncWrite } from '../index.js';
import { strictObjectBody, strictQueryString } from '../lib/strictBody.js';
import {
  buildWindow,
  clampDays,
  fillDailyGrowth,
  foldCounts,
  weekdayCoverage,
  DEFAULT_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
  MIN_WINDOW_DAYS,
} from '../lib/analyticsWindow.js';
import type { AnalyticsWindow } from '../lib/analyticsWindow.js';

type Db = ReturnType<typeof getDb>;
type Where = SQL | undefined;

/**
 * How many concepts the ranked list returns.
 *
 * Exported in the payload as `topConceptsLimit` beside `conceptCount`,
 * because the dashboard used to read `topConcepts.length` as "how many
 * concepts exist" — a tile that says 20 whether the store holds 20 concepts
 * or 2,000. A page size is not a statistic.
 */
const TOP_CONCEPTS_LIMIT = 20;

interface ScopedTotals {
  total: number;
  /** `null`, never 0, when the scope is empty — 0 would read as "all unimportant". */
  avgImportance: number | null;
  conceptCount: number;
  sourceCount: number;
}

/** The four scalars that describe any one scope, in a single aggregate query. */
async function readTotals(db: Db, where: Where): Promise<ScopedTotals> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      avgImportance: sql<number | null>`avg(${schema.memories.importance})`,
      // count(distinct …) ignores NULLs, which is what we want for concept.
      // For source it is not: NULL is a real bucket that foldCounts() reports
      // as 'unknown', so it is coalesced here too and the count agrees with
      // the number of keys in bySource.
      conceptCount: sql<number>`count(distinct ${schema.memories.concept})`,
      sourceCount: sql<number>`count(distinct coalesce(${schema.memories.source}, 'unknown'))`,
    })
    .from(schema.memories)
    .where(where);

  return {
    total: row?.total ?? 0,
    avgImportance: row?.avgImportance ?? null,
    conceptCount: row?.conceptCount ?? 0,
    sourceCount: row?.sourceCount ?? 0,
  };
}

/** `{ key: count }` breakdowns. Both are complete for their scope — no LIMIT. */
async function readBreakdowns(db: Db, where: Where) {
  const byType = await db
    .select({ key: schema.memories.type, count: sql<number>`count(*)` })
    .from(schema.memories)
    .where(where)
    .groupBy(schema.memories.type);

  const bySource = await db
    .select({ key: schema.memories.source, count: sql<number>`count(*)` })
    .from(schema.memories)
    .where(where)
    .groupBy(schema.memories.source);

  return { byType: foldCounts(byType), bySource: foldCounts(bySource) };
}

/**
 * The two time series. `dailyGrowth` comes back sparse from SQL and is
 * zero-filled by the caller; `hourlyActivity` stays sparse on purpose — its
 * domain is a fixed 7×24 grid the client already knows, so an absent cell is
 * unambiguously zero and cannot be mistaken for an interpolated one.
 */
async function readSeries(db: Db, where: Where) {
  // substr(), not date(): the window filter is a string comparison on the
  // date prefix, so bucketing by that same prefix makes "every row the filter
  // admits falls on one of the window's days" true by construction instead of
  // by argument. date() re-parses the timestamp, and for anything the parser
  // reads differently from a prefix compare — an offset suffix like
  // '…T01:00:00+05:00', or a value it cannot parse at all and returns NULL for
  // — a row would be counted in windowed.total but land on no day, and
  // sum(dailyGrowth) would quietly stop matching it.
  //
  // The one thing this gives up is UTC-normalising an offset timestamp, which
  // no writer in this repo produces. The heatmap below still goes through
  // SQLite's parser, because a 7×24 grid has no such invariant to keep.
  const day = sql<string>`substr(${schema.memories.createdAt}, 1, 10)`;
  const hour = sql<number>`cast(strftime('%H', ${schema.memories.createdAt}) as integer)`;
  const dayOfWeek = sql<number>`cast(strftime('%w', ${schema.memories.createdAt}) as integer)`;

  const growth = await db
    .select({ date: day, count: sql<number>`count(*)` })
    .from(schema.memories)
    .where(where)
    .groupBy(day)
    .orderBy(day);

  const hourlyActivity = await db
    .select({ hour, dayOfWeek, count: sql<number>`count(*)` })
    .from(schema.memories)
    .where(where)
    .groupBy(hour, dayOfWeek);

  return { growth, hourlyActivity };
}

/**
 * The ranked concept list. Bounded — see TOP_CONCEPTS_LIMIT.
 *
 * Tie-broken by concept name. Counts tie constantly (79 concepts in a typical
 * 30-day window, most of them 1), and without a second key SQLite is free to
 * return tied rows in any order — so a dashboard that re-fetches on a timer
 * reshuffles its bar chart, and members drop in and out of the top 20, with
 * no data having changed.
 */
async function readTopConcepts(db: Db, where: Where) {
  return db
    .select({
      concept: schema.memories.concept,
      count: sql<number>`count(*)`,
      avgImportance: sql<number>`avg(${schema.memories.importance})`,
    })
    .from(schema.memories)
    .where(and(where, sql`${schema.memories.concept} is not null`))
    .groupBy(schema.memories.concept)
    .orderBy(desc(sql`count(*)`), schema.memories.concept)
    .limit(TOP_CONCEPTS_LIMIT);
}

/** Active memories that already existed when the window opened. Seeds `cumulative`. */
async function readBaseline(db: Db, where: Where): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.memories)
    .where(where);
  return row?.count ?? 0;
}

/** Everything scoped to the requested window. */
async function readWindowed(db: Db, where: Where, win: AnalyticsWindow, baseline: number) {
  const totals = await readTotals(db, where);
  const { byType, bySource } = await readBreakdowns(db, where);
  const { growth, hourlyActivity } = await readSeries(db, where);
  const topConcepts = await readTopConcepts(db, where);

  return {
    total: totals.total,
    avgImportance: totals.avgImportance,
    byType,
    bySource,
    sourceCount: totals.sourceCount,
    conceptCount: totals.conceptCount,
    topConcepts,
    topConceptsLimit: TOP_CONCEPTS_LIMIT,
    baseline,
    dailyGrowth: fillDailyGrowth(growth, win, baseline),
    hourlyActivity,
    weekdayCoverage: weekdayCoverage(win),
  };
}

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { days?: number } }>('/analytics', {
    schema: {
      tags: ['analytics'],
      summary: 'Aggregated memory analytics, scoped to an explicit time window',
      description: [
        'Every number under `windowed` is computed over `window` (the last `days`',
        'UTC calendar days, inclusive of today). The only figures that are not are',
        'under `allTime`, which says so in its name. `excludesArchived` is true for',
        'the whole payload: archived memories are counted nowhere, including in the',
        'past days of the growth series.',
        '',
        '`windowed.dailyGrowth` has exactly `window.days` entries — days with no',
        'memories are present with count 0, so a client never has to guess which',
        'days were omitted. `count` is memories created that day; `cumulative` is',
        'memories still active now that were created on or before that day, seeded',
        'by `windowed.baseline` (those that predate the window). It is not the',
        'historical size of the store — see `excludesArchived`.',
        '',
        '`windowed.hourlyActivity` is sparse over a fixed 7×24 grid (dayOfWeek 0 =',
        'Sunday, matching SQLite): an absent cell is zero. `windowed.weekdayCoverage`',
        'gives how many times each weekday falls in the window, for clients turning',
        'those counts into a rate; the last day is today and is partial.',
        '',
        '`windowed.conceptCount` and `windowed.sourceCount` are real counts of',
        'distinct values; `topConcepts` is a ranked page of at most',
        '`topConceptsLimit`. `bySource` and `byType` are complete for their scope.',
        '`avgImportance` is null, not 0, when a scope holds no memories.',
      ].join(' '),
      // Without bounds, ?days=abc produced NaN and the Date math threw a 500.
      // additionalProperties:false is the other half: ?day=90 (a typo) used to
      // be silently ignored and answered with a 30-day window that the caller
      // believed was 90 — the same class of quiet lie this endpoint is being
      // fixed for.
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          days: {
            type: 'integer',
            minimum: MIN_WINDOW_DAYS,
            maximum: MAX_WINDOW_DAYS,
            default: DEFAULT_WINDOW_DAYS,
          },
        },
      },
    },
    // Runs before the schema: Fastify's ajv strips unknown keys rather than
    // refusing them, so `additionalProperties: false` above documents the
    // contract but does not enforce it. This does.
    preValidation: strictQueryString(['days']),
    handler: async (req) => {
      const db = getDb();
      const win = buildWindow(clampDays(req.query.days));

      const ns = brain.getNamespace();
      const nsCond = ns ? eq(schema.memories.namespace, ns) : undefined;
      const active = isNull(schema.memories.archivedAt);
      const allTimeWhere = nsCond ? and(active, nsCond) : active;

      // Half-open [start, day-after-end), compared on the date prefix rather
      // than the full instant. created_at is TEXT and the comparison is a
      // string one, so the format matters: every writer in this repo stamps
      // ISO ('…T12:00:00.000Z') but SQLite's own CURRENT_TIMESTAMP default
      // writes '… 12:00:00', and ' ' < 'T'. An instant bound would push a
      // space-formatted row on the window's first day into the baseline while
      // the day bucket still placed it inside the window. A bare 'YYYY-MM-DD'
      // sorts below every timestamp on that day in either format, and
      // readSeries() buckets on the same prefix, so the filter and the day
      // enumeration cannot disagree.
      //
      // The upper bound matters for the same reason the lower one does:
      // without it a clock-skewed row dated next year lands in the window but
      // in none of its days, and sum(dailyGrowth) stops matching
      // windowed.total.
      const fromDate = win.start;
      const untilDate = win.endsBefore.slice(0, 10);
      const windowWhere = and(
        allTimeWhere,
        gte(schema.memories.createdAt, fromDate),
        lt(schema.memories.createdAt, untilDate)
      );
      const beforeWindowWhere = and(allTimeWhere, lt(schema.memories.createdAt, fromDate));

      const baseline = await readBaseline(db, beforeWindowWhere);

      return {
        window: win,
        // Applies to every number below, windowed and all-time alike, and to
        // the past days of the growth series. Machine-readable because a
        // reader cannot otherwise tell that a curve which dips in the past is
        // reporting today's survivors rather than that day's store.
        excludesArchived: true,
        windowed: await readWindowed(db, windowWhere, win, baseline),
        allTime: await readTotals(db, allTimeWhere),
      };
    },
  });

  app.patch<{
    Params: { id: string };
    Body: { content?: string; importance?: number; tags?: string[]; concept?: string };
  }>('/memory/:id', {
    schema: {
      tags: ['memory'],
      summary: 'Inline edit a memory (content, importance, tags, concept)',
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string', minLength: 1 },
          importance: { type: 'number', minimum: 0, maximum: 1 },
          tags: { type: 'array', items: { type: 'string' } },
          concept: { type: 'string' },
        },
      },
    },
    handler: async (req, reply) => {
      const db = getDb();
      const { id } = req.params;
      const { content, importance, tags, concept } = req.body;

      const [existing] = await db
        .select()
        .from(schema.memories)
        .where(eq(schema.memories.id, id))
        .limit(1);

      if (!existing || !brain.canAccessNamespace(existing.namespace)) {
        reply.code(404);
        return { error: 'Memory not found' };
      }

      const updates: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
        deviceId: getDeviceId(),
      };
      if (content !== undefined) updates['content'] = content;
      if (importance !== undefined) updates['importance'] = importance;
      if (tags !== undefined) updates['tags'] = JSON.stringify(tags);
      if (concept !== undefined) updates['concept'] = concept;

      // Editing content invalidates the stored vector. Without re-embedding, the
      // persisted embedding and the in-memory index keep describing the OLD text,
      // so search silently returns the wrong rows (and survives restart).
      let newVector: Float32Array | null = null;
      if (content !== undefined && content !== existing.content) {
        const embeddableText = existing.concept
          ? `${concept ?? existing.concept}: ${content}`
          : content;
        newVector = await embed(embeddableText);
        updates['embedding'] = packFP16(newVector);
        updates['embeddingDim'] = newVector.length;
      }

      await db
        .update(schema.memories)
        .set(updates)
        .where(eq(schema.memories.id, id));
      notifySyncWrite();

      if (newVector) {
        brain.getVectorSearch().upsert({
          id,
          vector: newVector,
          type: existing.type as MemoryType,
          namespace: existing.namespace ?? undefined,
        });
      }

      const [updated] = await db
        .select()
        .from(schema.memories)
        .where(eq(schema.memories.id, id))
        .limit(1);

      return updated;
    },
  });

  app.post<{ Body: { ids: string[]; tag: string } }>('/memory/bulk/tag', {
    schema: {
      tags: ['memory'],
      summary: 'Add a tag to multiple memories at once',
      body: {
        type: 'object',
        required: ['ids', 'tag'],
        properties: {
          // Bounded: this loops one query per id, so an unbounded array is a
          // trivial resource-exhaustion vector.
          ids: { type: 'array', maxItems: 1000, items: { type: 'string' } },
          tag: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: async (req) => {
      const db = getDb();
      const { ids, tag } = req.body;
      let modified = 0;
      // Hoisted out of the loop: one device id for the whole batch, and a
      // single db.insert (inside getDeviceId's first-call path) instead of one
      // per row.
      const deviceId = getDeviceId();

      for (const id of ids) {
        const [mem] = await db
          .select()
          .from(schema.memories)
          .where(eq(schema.memories.id, id))
          .limit(1);
        if (!mem || !brain.canAccessNamespace(mem.namespace)) continue;

        const existing: string[] = JSON.parse(mem.tags ?? '[]');
        if (!existing.includes(tag)) {
          existing.push(tag);
          await db
            .update(schema.memories)
            .set({ tags: JSON.stringify(existing), updatedAt: new Date().toISOString(), deviceId })
            .where(eq(schema.memories.id, id));
          modified++;
        }
      }
      if (modified > 0) notifySyncWrite();

      return { modified, total: ids.length };
    },
  });

  app.post<{ Body: { ids: string[] } }>('/memory/bulk/archive', {
    schema: {
      tags: ['memory'],
      summary: 'Archive multiple memories at once',
      // This was the only bulk endpoint with no body schema at all — no
      // `required`, no types, no bound. Every one of those omissions was
      // reachable: no body 500'd on the destructure; {"ids":"abc"} iterated
      // the string's characters and reported three archives; {"ids":12} threw
      // "ids is not iterable"; and a 1 MiB body holds ~25k ids, i.e. 25k
      // sequential transactions and 25k webhook dispatches from one request.
      // Bounds match /memory/bulk/tag, which loops the same way.
      body: {
        type: 'object',
        required: ['ids'],
        additionalProperties: false,
        properties: {
          ids: {
            type: 'array',
            minItems: 1,
            maxItems: 1000,
            items: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    // Runs before the schema: Fastify's ajv coerces a scalar into a
    // single-element array and strips unknown keys, so neither {"ids":"abc"}
    // nor a stray extra key would be reported without this.
    preValidation: strictObjectBody(['ids'], ['ids']),
    handler: async (req) => {
      const db = getDb();
      const { ids } = req.body;

      // Resolve what is actually archivable first, in one query.
      // brain.forget() only verifies existence in isolated mode, so unknown
      // ids used to be counted as archived and — worse — fired a 'forgotten'
      // webhook and an onForget plugin hook for a memory that never existed.
      const unique = [...new Set(ids)];
      const rows = await db
        .select({ id: schema.memories.id, namespace: schema.memories.namespace })
        .from(schema.memories)
        .where(and(inArray(schema.memories.id, unique), isNull(schema.memories.archivedAt)));

      let archived = 0;
      for (const row of rows) {
        if (!brain.canAccessNamespace(row.namespace)) continue;
        try {
          await brain.forget(row.id);
          archived++;
        } catch (err: unknown) {
          // A row can be archived by another caller between the lookup and
          // this call; the rest of the batch must still go through.
          req.log.warn({ err, id: row.id }, 'bulk archive skipped a memory');
        }
      }
      if (archived > 0) notifySyncWrite();

      return { archived, total: ids.length };
    },
  });
};
