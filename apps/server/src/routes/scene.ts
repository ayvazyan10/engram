/**
 * Endpoints that feed the 3D scene: where every memory sits, and which edges
 * actually exist between the memories on screen.
 *
 * Both were previously assembled client-side out of the wrong primitives. The
 * dashboard fetched a page of memories and scattered them on a sphere by a
 * hash of their id, so position meant nothing; and it asked
 * `GET /graph/:id` for the top 30 memories by importance, which surfaced ~67
 * edges out of thousands and skewed them toward important nodes.
 *
 * Position now comes from a PCA of the stored embeddings — computed here,
 * because the vectors live here and 653 x 384 floats is about a megabyte a
 * browser has no reason to download — and edges come from one bulk query that
 * reports its own totals so the UI can say what it is not showing.
 */

import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema, unpackFP16 } from '@engram-ai-memory/core';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { brain } from '../index.js';
import { fitToBox, pca3, type Vec3 } from '../lib/pca.js';
import { strictQueryString } from '../lib/strictBody.js';

/**
 * Half-width of the world box every projection is scaled into.
 *
 * Fixed rather than data-derived so the dashboard's camera framing is stable:
 * a store whose variance happens to fall differently must not change how far
 * away the camera has to sit.
 */
export const WORLD_HALF_EXTENT = 42;

/** Where memories with no usable embedding are parked — just outside the box. */
const UNPROJECTED_SHELL = WORLD_HALF_EXTENT * 1.18;

/** Longest label the scene ever renders; anything more is payload for nothing. */
const LABEL_MAX = 80;

export type LayoutMethod = 'pca3' | 'fallback';

export interface SceneNode {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural';
  label: string;
  importance: number;
  source: string | null;
  accessCount: number;
  createdAt: string;
  lastAccessedAt: string | null;
  x: number;
  y: number;
  z: number;
  /** False when this node's position is a hash-derived placeholder, not a projection. */
  projected: boolean;
}

export interface LayoutPayload {
  method: LayoutMethod;
  fingerprint: string;
  generatedAt: string;
  halfExtent: number;
  count: number;
  projected: number;
  unprojected: number;
  explainedVariance: readonly number[];
  embeddingModel: string | null;
  computeMs: number;
  nodes: SceneNode[];
}

// ─── Deterministic placeholder positions ─────────────────────────────────────

/** murmur3 fmix32 — a real avalanche, so one bit in changes half the bits out. */
function fmix32(h: number): number {
  let x = h >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Stable pseudo-random in [0,1) for an id under a salt. Salt goes FIRST. */
function idRandom(id: string, salt: string): number {
  let h = 0x811c9dc5;
  const s = salt + ':' + id;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return fmix32(h) / 4294967296;
}

/**
 * A defined, visibly separate place for anything that cannot be projected: a
 * shell outside the projected cloud, so it reads as "not placed by meaning"
 * rather than being quietly mixed in among nodes that were.
 */
function shellPosition(id: string, radius: number): Vec3 {
  const u = idRandom(id, 'shell-u');
  const v = idRandom(id, 'shell-v');
  const phi = Math.acos(1 - 2 * u);
  const theta = v * Math.PI * 2;
  return [
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ];
}

// ─── Data loading ────────────────────────────────────────────────────────────

/**
 * Scope the node set exactly as `GET /api/memory` scopes its list, so the
 * scene and the sidebar can never disagree about which memories exist.
 */
function memoryScope(): SQL[] {
  const conditions: SQL[] = [isNull(schema.memories.archivedAt)];
  const namespace = brain.getNamespace();
  if (namespace) conditions.push(eq(schema.memories.namespace, namespace));
  return conditions;
}

function labelFor(concept: string | null, content: string): string {
  const raw = concept ?? content;
  return raw.replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
}

function toVector(blob: unknown, dim: number): Float32Array | null {
  if (!blob) return null;
  try {
    const vector = unpackFP16(Buffer.from(blob as ArrayBuffer));
    if (vector.length !== dim || vector.length === 0) return null;
    return vector;
  } catch {
    return null;
  }
}

// ─── Layout ──────────────────────────────────────────────────────────────────

interface LoadedRow {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural';
  concept: string | null;
  content: string;
  importance: number;
  source: string | null;
  accessCount: number;
  createdAt: string;
  lastAccessedAt: string | null;
  embedding: unknown;
  embeddingDim: number;
}

function baseNode(row: LoadedRow, position: Vec3, projected: boolean): SceneNode {
  return {
    id: row.id,
    type: row.type,
    label: labelFor(row.concept, row.content),
    importance: row.importance,
    source: row.source,
    accessCount: row.accessCount,
    createdAt: row.createdAt,
    lastAccessedAt: row.lastAccessedAt,
    x: position[0],
    y: position[1],
    z: position[2],
    projected,
  };
}

/**
 * Turn rows into placed nodes.
 *
 * Rows carrying a usable embedding are projected; everything else — a memory
 * stored before embeddings existed, one whose vector failed to unpack, or every
 * row at all if the store is too small for a 3-component fit — lands on the
 * placeholder shell and is reported as `unprojected` so the UI can say so.
 */
function placeNodes(rows: readonly LoadedRow[]): Omit<LayoutPayload, 'fingerprint' | 'generatedAt' | 'embeddingModel' | 'computeMs'> {
  const withVectors: { row: LoadedRow; vector: Float32Array }[] = [];
  const without: LoadedRow[] = [];
  for (const row of rows) {
    const vector = toVector(row.embedding, row.embeddingDim);
    if (vector) withVectors.push({ row, vector });
    else without.push(row);
  }

  const result = pca3(withVectors.map((entry) => entry.vector));
  const nodes: SceneNode[] = [];

  if (result) {
    const boxed = fitToBox(result.coords, WORLD_HALF_EXTENT);
    withVectors.forEach((entry, index) => {
      nodes.push(baseNode(entry.row, boxed[index] as Vec3, true));
    });
  }

  const unplaced = result ? without : rows;
  for (const row of unplaced) {
    nodes.push(baseNode(row, shellPosition(row.id, result ? UNPROJECTED_SHELL : WORLD_HALF_EXTENT), false));
  }

  return {
    method: result ? 'pca3' : 'fallback',
    halfExtent: WORLD_HALF_EXTENT,
    count: rows.length,
    projected: result ? withVectors.length : 0,
    unprojected: result ? without.length : rows.length,
    explainedVariance: result ? result.explained : [0, 0, 0],
    nodes,
  };
}

// ─── Caching ─────────────────────────────────────────────────────────────────
//
// A PCA over the whole store must not run per request. Both caches key on a
// fingerprint of the rows they read — row count plus the newest timestamp —
// so any store, archive, edit or delete invalidates them and nothing else does.

let layoutCache: { fingerprint: string; payload: LayoutPayload } | null = null;
let edgeCache: { fingerprint: string; edges: SceneEdge[]; stored: number } | null = null;

/** Drops both caches. Exported for tests, which build stores between cases. */
export function resetSceneCaches(): void {
  layoutCache = null;
  edgeCache = null;
}

async function memoryFingerprint(): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      newest: sql<string | null>`max(${schema.memories.updatedAt})`,
      created: sql<string | null>`max(${schema.memories.createdAt})`,
    })
    .from(schema.memories)
    .where(and(...memoryScope()));
  return `m:${row?.total ?? 0}:${row?.newest ?? '-'}:${row?.created ?? '-'}:${brain.getNamespace() ?? '-'}`;
}

async function buildLayout(fingerprint: string): Promise<LayoutPayload> {
  const db = getDb();
  const startedAt = Date.now();
  const rows = (await db
    .select({
      id: schema.memories.id,
      type: schema.memories.type,
      concept: schema.memories.concept,
      content: schema.memories.content,
      importance: schema.memories.importance,
      source: schema.memories.source,
      accessCount: schema.memories.accessCount,
      createdAt: schema.memories.createdAt,
      lastAccessedAt: schema.memories.lastAccessedAt,
      embedding: schema.memories.embedding,
      embeddingDim: schema.memories.embeddingDim,
    })
    .from(schema.memories)
    .where(and(...memoryScope()))
    // Fixed order, so the PCA fit subsample is the same set on every call.
    .orderBy(schema.memories.id)) as LoadedRow[];

  return {
    ...placeNodes(rows),
    fingerprint,
    generatedAt: new Date().toISOString(),
    embeddingModel: brain.getEmbeddingModel(),
    computeMs: Date.now() - startedAt,
  };
}

// ─── Edges ───────────────────────────────────────────────────────────────────

export interface SceneEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: string;
  strength: number;
}

const EDGE_LIMIT_MAX = 20000;

async function edgeFingerprint(memory: string): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      newest: sql<string | null>`max(coalesce(${schema.memoryConnections.updatedAt}, ${schema.memoryConnections.createdAt}))`,
    })
    .from(schema.memoryConnections)
    .where(isNull(schema.memoryConnections.deletedAt));
  return `${memory}|c:${row?.total ?? 0}:${row?.newest ?? '-'}`;
}

/**
 * Every edge whose BOTH endpoints are memories the dashboard can see.
 *
 * An edge onto an archived memory is not renderable — there is no node to draw
 * it to — so it is excluded here and counted separately rather than dropped in
 * silence, which is what the client used to do with its pagination window.
 */
async function loadVisibleEdges(): Promise<{ edges: SceneEdge[]; stored: number }> {
  const db = getDb();
  const visible = new Set(
    (
      await db
        .select({ id: schema.memories.id })
        .from(schema.memories)
        .where(and(...memoryScope()))
    ).map((row) => row.id)
  );

  const rows = await db
    .select({
      id: schema.memoryConnections.id,
      sourceId: schema.memoryConnections.sourceId,
      targetId: schema.memoryConnections.targetId,
      relationship: schema.memoryConnections.relationship,
      strength: schema.memoryConnections.strength,
    })
    .from(schema.memoryConnections)
    .where(isNull(schema.memoryConnections.deletedAt));

  const edges = rows.filter(
    (row) =>
      row.sourceId !== row.targetId && visible.has(row.sourceId) && visible.has(row.targetId)
  );
  // Strongest first, so a `limit` truncates the weakest rather than an
  // arbitrary slice of insertion order.
  edges.sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1));
  return { edges, stored: rows.length };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export const sceneRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/graph/layout — one 3D coordinate per memory, from its embedding.
  //
  // Registered after graphRoutes' `/graph/:id`; find-my-way matches the static
  // segment first, so this is not shadowed by the parametric route. The test
  // 'serves the layout, not the :id handler' pins that.
  app.get('/graph/layout', {
    schema: {
      tags: ['graph'],
      summary:
        'PCA projection of every memory embedding into a fixed 3D box. Cached until the memory set changes.',
    },
    handler: async () => {
      const fingerprint = await memoryFingerprint();
      if (layoutCache?.fingerprint === fingerprint) return layoutCache.payload;
      const payload = await buildLayout(fingerprint);
      layoutCache = { fingerprint, payload };
      return payload;
    },
  });

  // GET /api/graph/edges — every renderable edge, with honest totals.
  app.get<{ Querystring: { minStrength?: number; limit?: number } }>('/graph/edges', {
    schema: {
      tags: ['graph'],
      summary: 'All connections whose endpoints are both visible memories, strongest first',
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          minStrength: { type: 'number', minimum: 0, maximum: 1, default: 0 },
          limit: { type: 'integer', minimum: 1, maximum: EDGE_LIMIT_MAX, default: EDGE_LIMIT_MAX },
        },
      },
    },
    // `additionalProperties: false` above documents the contract and is what
    // OpenAPI publishes, but it does not enforce it: Fastify's ajv runs with
    // removeAdditional and strips an unknown key in silence, so
    // ?minStrenght=0.9 (a typo) was answered 200 with every edge in the store
    // and read as a filtered set. Same guard, same reason, as /api/analytics.
    preValidation: strictQueryString(['minStrength', 'limit']),
    handler: async (req) => {
      const minStrength = req.query.minStrength ?? 0;
      const limit = req.query.limit ?? EDGE_LIMIT_MAX;

      const fingerprint = await edgeFingerprint(await memoryFingerprint());
      if (edgeCache?.fingerprint !== fingerprint) {
        const loaded = await loadVisibleEdges();
        edgeCache = { fingerprint, edges: loaded.edges, stored: loaded.stored };
      }

      const all = edgeCache.edges;
      const matching = minStrength > 0 ? all.filter((e) => e.strength >= minStrength) : all;
      const edges = matching.length > limit ? matching.slice(0, limit) : matching;

      return {
        // Renderable edges in the store, before this request's filter.
        total: all.length,
        // Non-deleted connection rows, including ones onto archived memories.
        stored: edgeCache.stored,
        matching: matching.length,
        returned: edges.length,
        truncated: edges.length < matching.length,
        minStrength,
        limit,
        edges,
      };
    },
  });
};
