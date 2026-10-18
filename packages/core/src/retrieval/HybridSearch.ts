import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import type { MemoryType } from '../db/schema.js';
import { cosineSimilarity, type SearchResult, type VectorSearch } from './VectorSearch.js';

export interface HybridResult extends SearchResult {
  /** RRF normalized to [0, 1] for the existing importance scorer. */
  relevance: number;
}

/** Quote literal Unicode words; punctuation and FTS operators never become syntax. */
export function escapeMatch(query: string): string {
  return (query.match(/[\p{L}\p{N}\p{M}]+/gu) ?? [])
    .map((token) => `"${token.replaceAll('"', '""')}"`).join(' AND ');
}

/** SQLite is the only primary backend; Postgres stores sync data, not retrieval indexes. */
export function keywordSearch(
  query: string, topK: number, types?: MemoryType[], namespace?: string | null,
  crossNamespace = false, includeGlobal = false,
): Array<{ id: string; type: MemoryType }> {
  const match = escapeMatch(query);
  if (!match || !(topK >= 1)) return [];
  const memories = schema.memories;
  const scopeNamespace = namespace === undefined && includeGlobal ? null : namespace;
  const scope = scopeNamespace !== undefined && !crossNamespace
    ? scopeNamespace === null ? isNull(memories.namespace)
      : includeGlobal ? or(eq(memories.namespace, scopeNamespace), isNull(memories.namespace))
        : eq(memories.namespace, scopeNamespace)
    : undefined;
  return getDb().select({ id: memories.id, type: memories.type }).from(memories)
    .innerJoin(sql`memories_fts`, sql`memories_fts.rowid = ${memories}.rowid`)
    .where(and(
      sql`memories_fts MATCH ${match}`,
      isNull(memories.archivedAt), scope,
      types ? inArray(memories.type, types) : undefined,
    ))
    .orderBy(sql`bm25(memories_fts)`, memories.id)
    .limit(Math.floor(topK)).all();
}

/** Fuse top-N lists with k=60, retaining keyword hits below the cosine threshold. */
export function hybridSearch(
  index: VectorSearch, query: string, vector: Float32Array, topK: number,
  threshold: number, types?: MemoryType[], namespace?: string | null,
  crossNamespace = false, includeGlobal = false,
): HybridResult[] {
  const scopeNamespace = namespace === undefined && includeGlobal ? null : namespace;
  const vectors = index.search(vector, topK, -Infinity, types, scopeNamespace, crossNamespace, includeGlobal);
  const entries = index.entriesById();
  // Reconciliation already rejected incompatible vectors and counted externalSkipped.
  const keywords = keywordSearch(query, topK, types, scopeNamespace, crossNamespace, includeGlobal)
    .filter((hit) => entries.has(hit.id));
  if (!keywords.length) return vectors.filter((hit) => hit.similarity >= threshold)
    .map((hit) => ({ ...hit, relevance: hit.similarity }));
  const fused = new Map<string, HybridResult>();
  for (const [rank, hit] of vectors.entries()) {
    fused.set(hit.id, { ...hit, relevance: 1 / (60 + rank + 1) });
  }
  for (const [rank, hit] of keywords.entries()) {
    const previous = fused.get(hit.id);
    const entry = entries.get(hit.id);
    const similarity = previous?.similarity ?? (entry
      ? cosineSimilarity(vector, entry.vector, index.dimension) : 0);
    fused.set(hit.id, { ...hit, similarity,
      relevance: (previous?.relevance ?? 0) + 1 / (60 + rank + 1) });
  }
  const keywordIds = new Set(keywords.map((hit) => hit.id));
  return [...fused.values()]
    .filter((hit) => hit.similarity >= threshold || keywordIds.has(hit.id))
    .sort((a, b) => b.relevance - a.relevance || Number(keywordIds.has(b.id)) - Number(keywordIds.has(a.id)))
    .slice(0, Math.floor(topK))
    .map((hit) => ({ ...hit, relevance: hit.relevance * 61 / 2 }));
}
