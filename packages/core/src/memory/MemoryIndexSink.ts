/**
 * The seam between the direct memory writers and the brain's in-memory state.
 *
 * `brain.episodic`, `brain.semantic` and `brain.procedural` are public members,
 * so callers write through them as a first-class API — but they only ever wrote
 * to SQLite. Nothing put the new vector into the index or the new node into the
 * graph, so `stats()` counted a memory that `search()` could never surface, and
 * `semantic.update()` left the index holding a vector the database had already
 * replaced.
 *
 * NeuralBrain hands each writer a sink so those rows land in exactly the same
 * index and graph state `NeuralBrain.store()` maintains. The writers stay usable
 * standalone: without a sink they behave as before, writing to the database only.
 */

import type { MemoryType, RelationshipType } from '../db/schema.js';

/** An edge to mirror into the in-memory graph alongside the row. */
export interface MemoryIndexEdge {
  sourceId: string;
  targetId: string;
  relationship: RelationshipType;
  strength: number;
  bidirectional: boolean;
}

/** One committed row's worth of index and graph state. */
export interface MemoryIndexWrite {
  id: string;
  type: MemoryType;
  namespace: string | null;
  concept?: string | null;
  /** The vector that was written to the row, in full float32 precision. */
  vector: Float32Array;
  edges?: readonly MemoryIndexEdge[];
}

export interface MemoryIndexSink {
  /**
   * Publish a row that has just been committed.
   *
   * Called only after the durable write succeeded, so in-memory state can never
   * run ahead of the database.
   */
  onMemoryWritten(write: MemoryIndexWrite): Promise<void>;
}
