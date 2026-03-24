/**
 * VectorSearch — cosine similarity search over in-memory vector index.
 *
 * For small-to-medium datasets (up to ~100k records) this brute-force approach
 * with typed arrays is fast enough (<10ms for 10k vectors).
 *
 * For larger datasets, swap the search() method for an HNSW implementation
 * or pgvector (PostgreSQL) without changing the interface.
 *
 * Supports persistence: serialize() and deserialize() save/load the full index
 * to/from a Buffer for disk caching. On startup, load the cached index and
 * incrementally add only new memories instead of re-scanning the entire DB.
 */

import fs from 'fs';
import path from 'path';

/** Magic bytes + version for the persisted index format */
const INDEX_MAGIC = 0x454e4752; // 'ENGR'
const INDEX_VERSION = 1;

export interface IndexMetadata {
  /** Number of entries in the index */
  entryCount: number;
  /** Embedding dimension */
  dimension: number;
  /** Timestamp when the index was saved */
  savedAt: string;
  /** Set of memory IDs in the index (for incremental sync) */
  ids: Set<string>;
}

export interface VectorEntry {
  id: string;
  vector: Float32Array;
  type: 'episodic' | 'semantic' | 'procedural';
  namespace?: string | null;
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
    types?: Array<'episodic' | 'semantic' | 'procedural'>,
    namespace?: string | null,
    crossNamespace?: boolean
  ): SearchResult[] {
    if (this.entries.length === 0) return [];

    let candidates = types
      ? this.entries.filter((e) => types.includes(e.type))
      : this.entries;

    // Namespace filtering: only when namespace is set and crossNamespace is not true
    if (namespace && !crossNamespace) {
      candidates = candidates.filter((e) => e.namespace === namespace);
    }

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

  /** Get all entry IDs currently in the index. */
  getIds(): Set<string> {
    return new Set(this.entries.map((e) => e.id));
  }

  /**
   * Serialize the index to a Buffer for disk persistence.
   *
   * Format:
   *   [4B magic][4B version][4B dim][4B count]
   *   For each entry:
   *     [4B id_len][id_bytes][1B type_code][1B has_namespace][ns_len?][ns_bytes?]
   *     [dim * 4B float32 vector]
   */
  serialize(): Buffer {
    const TYPE_MAP: Record<string, number> = { episodic: 0, semantic: 1, procedural: 2 };

    // Calculate total buffer size
    let totalSize = 16; // header: magic(4) + version(4) + dim(4) + count(4)
    for (const entry of this.entries) {
      const idBytes = Buffer.byteLength(entry.id, 'utf8');
      const nsBytes = entry.namespace ? Buffer.byteLength(entry.namespace, 'utf8') : 0;
      totalSize += 4 + idBytes + 1 + 1 + (entry.namespace ? 4 + nsBytes : 0) + this.dim * 4;
    }

    const buf = Buffer.allocUnsafe(totalSize);
    let offset = 0;

    // Header
    buf.writeUInt32LE(INDEX_MAGIC, offset); offset += 4;
    buf.writeUInt32LE(INDEX_VERSION, offset); offset += 4;
    buf.writeUInt32LE(this.dim, offset); offset += 4;
    buf.writeUInt32LE(this.entries.length, offset); offset += 4;

    // Entries
    for (const entry of this.entries) {
      const idBuf = Buffer.from(entry.id, 'utf8');
      buf.writeUInt32LE(idBuf.length, offset); offset += 4;
      idBuf.copy(buf, offset); offset += idBuf.length;

      buf.writeUInt8(TYPE_MAP[entry.type] ?? 0, offset); offset += 1;

      if (entry.namespace) {
        buf.writeUInt8(1, offset); offset += 1;
        const nsBuf = Buffer.from(entry.namespace, 'utf8');
        buf.writeUInt32LE(nsBuf.length, offset); offset += 4;
        nsBuf.copy(buf, offset); offset += nsBuf.length;
      } else {
        buf.writeUInt8(0, offset); offset += 1;
      }

      // Write vector as float32
      for (let i = 0; i < this.dim; i++) {
        buf.writeFloatLE(entry.vector[i] ?? 0, offset); offset += 4;
      }
    }

    return buf;
  }

  /**
   * Deserialize a Buffer back into the index, replacing all entries.
   * Returns metadata about the loaded index.
   * Throws if the buffer is corrupt or version mismatch.
   */
  deserialize(buf: Buffer): IndexMetadata {
    let offset = 0;

    const TYPE_RMAP: Array<'episodic' | 'semantic' | 'procedural'> = ['episodic', 'semantic', 'procedural'];

    // Header
    const magic = buf.readUInt32LE(offset); offset += 4;
    if (magic !== INDEX_MAGIC) throw new Error('Invalid index file: bad magic bytes');

    const version = buf.readUInt32LE(offset); offset += 4;
    if (version !== INDEX_VERSION) throw new Error(`Unsupported index version: ${version}`);

    const dim = buf.readUInt32LE(offset); offset += 4;
    if (dim !== this.dim) throw new Error(`Dimension mismatch: index has ${dim}, expected ${this.dim}`);

    const count = buf.readUInt32LE(offset); offset += 4;

    const entries: VectorEntry[] = [];
    const ids = new Set<string>();

    for (let i = 0; i < count; i++) {
      const idLen = buf.readUInt32LE(offset); offset += 4;
      const id = buf.toString('utf8', offset, offset + idLen); offset += idLen;

      const typeCode = buf.readUInt8(offset); offset += 1;
      const type = TYPE_RMAP[typeCode] ?? 'episodic';

      const hasNamespace = buf.readUInt8(offset); offset += 1;
      let namespace: string | undefined;
      if (hasNamespace) {
        const nsLen = buf.readUInt32LE(offset); offset += 4;
        namespace = buf.toString('utf8', offset, offset + nsLen); offset += nsLen;
      }

      const vector = new Float32Array(dim);
      for (let j = 0; j < dim; j++) {
        vector[j] = buf.readFloatLE(offset); offset += 4;
      }

      entries.push({ id, vector, type, namespace });
      ids.add(id);
    }

    this.entries = entries;

    return {
      entryCount: count,
      dimension: dim,
      savedAt: new Date().toISOString(),
      ids,
    };
  }

  /**
   * Save the index to a file on disk.
   */
  saveToDisk(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const buf = this.serialize();
    fs.writeFileSync(filePath, buf);
  }

  /**
   * Load the index from a file on disk.
   * Returns metadata, or null if file doesn't exist.
   */
  loadFromDisk(filePath: string): IndexMetadata | null {
    if (!fs.existsSync(filePath)) return null;
    const buf = fs.readFileSync(filePath);
    return this.deserialize(buf);
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
