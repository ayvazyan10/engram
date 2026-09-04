/**
 * Helpers for moving stored memory rows into the in-memory vector index.
 *
 * Every writer that puts a row into `VectorSearch` has to answer the same two
 * questions, and each one that answered them differently became a bug:
 *
 *  1. Is this vector even comparable to what the index holds? `upsert()` throws
 *     on a length mismatch on purpose — mixing dimensions makes cosine
 *     similarity score garbage. `reconcileIndex()` has always caught that and
 *     skipped the row; `initialize()`, `rebuildIndex()` and `store()` did not,
 *     so one row embedded by another model made the database un-initialisable.
 *  2. Does the index already hold exactly this vector? `initialize()` used to
 *     answer "yes" for any id present in its disk cache, without looking at the
 *     row — so a vector the database had since moved past was reloaded from the
 *     cache on every start and never corrected.
 */

import { packFP16, unpackFP16 } from '../embedding/Embedder.js';
import type { VectorEntry, VectorSearch } from './VectorSearch.js';

/** Unpack a stored FP16 embedding blob into a vector. */
export function storedVector(embedding: unknown): Float32Array {
  return unpackFP16(Buffer.from(embedding as ArrayBuffer));
}

/**
 * Dimension of a stored embedding blob, read from its byte length rather than
 * the `embedding_dim` column — the blob is what a reader actually gets, and a
 * row written by an external tool need not have kept the column in step.
 */
export function storedDimension(embedding: unknown): number {
  const view = embedding as ArrayBufferView | ArrayBuffer;
  const bytes = ArrayBuffer.isView(view) ? view.byteLength : view.byteLength;
  return Math.floor(bytes / 2); // FP16: two bytes per component
}

/**
 * Upsert unless the vector came from a model of another dimension.
 *
 * Returns false when the entry was refused. Callers must surface that count —
 * the memory exists and reads fine, but no search will ever surface it until
 * `re_embed` rewrites its vector, and silence there is how an operator ends up
 * with a database that quietly answers fewer queries than it holds.
 */
export function upsertIfCompatible(index: VectorSearch, entry: VectorEntry): boolean {
  if (entry.vector.length !== index.dimension) return false;
  index.upsert(entry);
  return true;
}

/** The stored row fields an index entry has to agree with to be current. */
export interface StoredIndexRow {
  embedding: unknown;
  type: string;
  namespace: string | null;
}

/**
 * Whether an already-indexed entry still matches the row the database holds.
 *
 * The vectors are compared in their FP16 form: the database stores the packed
 * bytes, while the index holds full float32 — either the raw vector `store()`
 * upserted or one unpacked from those same bytes. Packing the indexed vector is
 * therefore an exact comparison in both directions, where comparing floats
 * would call every store()-written entry stale and re-index the whole database
 * on each start.
 */
export function indexEntryIsCurrent(entry: VectorEntry | undefined, row: StoredIndexRow): boolean {
  if (!entry) return false;
  if (entry.type !== row.type) return false;
  if ((entry.namespace ?? null) !== row.namespace) return false;
  return packFP16(entry.vector).equals(Buffer.from(row.embedding as ArrayBuffer));
}
