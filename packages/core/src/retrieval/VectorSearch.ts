/**
 * VectorSearch — cosine similarity search over in-memory vector index.
 *
 * For small-to-medium datasets (up to ~100k records) this brute-force approach
 * with typed arrays is fast enough (<10ms for 10k vectors).
 *
 * For larger datasets, swap the search() method for an HNSW implementation
 * or pgvector (PostgreSQL) without changing the interface.
 */

export interface VectorEntry {
  id: string;
  vector: Float32Array;
  type: 'episodic' | 'semantic' | 'procedural';
}

export interface SearchResult {
  id: string;
  similarity: number;
  type: 'episodic' | 'semantic' | 'procedural';
}

export class VectorSearch {
  private entries: VectorEntry[] = [];
  private readonly dim: number;

  constructor(dim: number = 384) {
    this.dim = dim;
  }

  /** Add or update a vector in the index. */
  upsert(entry: VectorEntry): void {
    const existing = this.entries.findIndex((e) => e.id === entry.id);
    if (existing >= 0) {
      this.entries[existing] = entry;
    } else {
      this.entries.push(entry);
    }
  }

  /** Remove a vector from the index. */
  remove(id: string): void {
    this.entries = this.entries.filter((e) => e.id !== id);
  }

  /** Bulk load entries (replaces existing index). */
  load(entries: VectorEntry[]): void {
    this.entries = entries;
  }

  /** Number of indexed vectors. */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Find top-K most similar vectors to the query.
   *
   * @param query Normalized query vector (Float32Array of length dim)
   * @param topK Number of results to return (default: 10)
   * @param threshold Minimum similarity threshold 0.0–1.0 (default: 0.0)
   * @param types Optional filter by memory type
   */
  search(
    query: Float32Array,
    topK: number = 10,
    threshold: number = 0.0,
    types?: Array<'episodic' | 'semantic' | 'procedural'>
  ): SearchResult[] {
    if (this.entries.length === 0) return [];

    const candidates = types
      ? this.entries.filter((e) => types.includes(e.type))
      : this.entries;

    // Compute cosine similarities in a single pass
    const scores: Array<{ id: string; similarity: number; type: VectorEntry['type'] }> = [];

    for (const entry of candidates) {
      const sim = cosineSimilarity(query, entry.vector, this.dim);
      if (sim >= threshold) {
        scores.push({ id: entry.id, similarity: sim, type: entry.type });
      }
    }

    // Partial sort: we only need top-K
    scores.sort((a, b) => b.similarity - a.similarity);
    return scores.slice(0, topK);
  }

  /** Clear the entire index. */
  clear(): void {
    this.entries = [];
  }
}

/**
 * Cosine similarity between two normalized vectors.
 * Both vectors must have the same length.
 * For normalized vectors this equals the dot product.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array, dim: number): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < dim; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
