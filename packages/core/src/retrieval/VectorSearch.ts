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

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

/** Magic bytes + version for the persisted index format */
const INDEX_MAGIC = 0x454e4752; // 'ENGR'
/**
 * v2 records the embedding model and a CRC-32 over the entry payload. v1 files
 * are refused rather than migrated — the index is a cache, so the caller falls
 * back to rebuilding it from the database.
 */
const INDEX_VERSION = 2;

let crcTable: Int32Array | null = null;

/**
 * CRC-32 (IEEE 802.3) over a buffer.
 *
 * Hand-rolled rather than `zlib.crc32`, which only exists from Node 22.2 while
 * this package supports 22.0 — and rather than a hash from `crypto`, which costs
 * far more per byte than integrity checking a rebuildable cache warrants.
 */
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let bit = 0; bit < 8; bit++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[i] = c;
    }
  }

  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]!) & 0xff]!;
  }
  return (crc ^ -1) >>> 0;
}

export interface IndexMetadata {
  /** Number of entries in the index */
  entryCount: number;
  /** Embedding dimension */
  dimension: number;
  /** Embedding model the vectors were produced by, or null if unrecorded */
  embeddingModel: string | null;
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

/**
 * Temp path for an atomic write: a sibling of the target, so the rename that
 * replaces it stays within one filesystem. The random suffix keeps concurrent
 * writers — in this process or another — off each other's temp file.
 */
function tempSibling(filePath: string): string {
  return `${filePath}.${process.pid}.${randomUUID()}.tmp`;
}

export class VectorSearch {
  private entries: VectorEntry[] = [];
  private dim: number;
  /**
   * Model the indexed vectors came from, written into the header so a cached
   * index produced by a different model is refused instead of silently scoring
   * against incomparable vectors.
   *
   * Note the asymmetry: writers always tag the file, but a reader constructed
   * without a model id (the default) accepts any model, having no basis to judge.
   * A reader that cares must pass one — `new VectorSearch(dim)` used to inspect a
   * saved index gets no model protection.
   */
  private modelId: string | null;
  /** Tail of the async save queue — see saveToDiskAsync. */
  private pendingSave: Promise<void> = Promise.resolve();
  /**
   * Bumped by every save. An async write compares its own value before renaming
   * and steps aside if a newer save has since claimed the target — the queue
   * orders async writes against each other, but only this guards them against a
   * synchronous save (shutdown) that ran while one was in flight.
   */
  private saveGeneration = 0;

  constructor(dim: number = 384, modelId: string | null = null) {
    this.dim = dim;
    this.modelId = modelId;
  }

  /** The dimension this index currently holds vectors for. */
  get dimension(): number {
    return this.dim;
  }

  /** The embedding model recorded in saved indexes, or null if untracked. */
  get embeddingModel(): string | null {
    return this.modelId;
  }

  /**
   * Point the index at a different embedding model, dropping every vector — the
   * existing ones are not comparable to anything the new model produces.
   */
  setModelId(modelId: string | null): void {
    if (modelId === this.modelId) return;
    this.modelId = modelId;
    this.entries = [];
  }

  /**
   * Change the index dimension, dropping every existing vector.
   *
   * Required when the active embedding model changes: mixing dimensions made
   * cosine similarity iterate only the first N components and silently score
   * garbage, because upsert accepted any length.
   */
  setDimension(dim: number): void {
    if (dim === this.dim) return;
    this.dim = dim;
    this.entries = [];
  }

  /** Add or update a vector in the index. */
  upsert(entry: VectorEntry): void {
    if (entry.vector.length !== this.dim) {
      throw new Error(
        `Vector dimension mismatch for "${entry.id}": index holds ${this.dim}-dim vectors, got ${entry.vector.length}. ` +
          `Rebuild the index after switching embedding models.`
      );
    }
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
   *   [4B magic][4B version][4B dim][4B count][4B model_len][model_bytes][4B crc32]
   *   For each entry:
   *     [4B id_len][id_bytes][1B type_code][1B has_namespace][ns_len?][ns_bytes?]
   *     [dim * 4B float32 vector]
   *
   * The CRC covers the entry payload only — everything after the header. Header
   * fields are self-validating: a wrong magic, version or dimension is rejected
   * outright, and a garbled model string can only cause a mismatch, never a
   * silent misread.
   */
  serialize(): Buffer {
    const TYPE_MAP: Record<string, number> = { episodic: 0, semantic: 1, procedural: 2 };

    const modelBuf = Buffer.from(this.modelId ?? '', 'utf8');

    // header: magic(4) + version(4) + dim(4) + count(4) + model_len(4) + model + crc(4)
    const headerSize = 20 + modelBuf.length + 4;
    let totalSize = headerSize;
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
    buf.writeUInt32LE(modelBuf.length, offset); offset += 4;
    modelBuf.copy(buf, offset); offset += modelBuf.length;
    // Filled in once the payload it covers has been written.
    const crcOffset = offset; offset += 4;

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

    buf.writeUInt32LE(crc32(buf.subarray(headerSize)), crcOffset);

    return buf;
  }

  /**
   * Deserialize a Buffer back into the index, replacing all entries.
   * Returns metadata about the loaded index.
   *
   * Throws if the buffer is corrupt, written by another format version, holds a
   * different dimension, or was produced by a different embedding model. Callers
   * treat any of these as "cache unusable" and rebuild from their source of
   * truth — that is the whole point of validating here rather than scoring
   * queries against vectors that cannot be compared.
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

    const modelLen = buf.readUInt32LE(offset); offset += 4;
    const savedModel = modelLen > 0 ? buf.toString('utf8', offset, offset + modelLen) : null;
    offset += modelLen;

    const expectedCrc = buf.readUInt32LE(offset); offset += 4;

    // Only enforce the model when this instance tracks one — a caller that keeps
    // no model has no basis to reject the file.
    if (this.modelId !== null && savedModel !== this.modelId) {
      throw new Error(
        `Embedding model mismatch: index was built with ${savedModel ?? 'an unrecorded model'}, expected ${this.modelId}`
      );
    }

    const actualCrc = crc32(buf.subarray(offset));
    if (actualCrc !== expectedCrc) {
      throw new Error(`Index checksum mismatch: payload is corrupt (expected ${expectedCrc}, got ${actualCrc})`);
    }

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

    // `count` sits in the header, outside the CRC, and nothing else cross-checks
    // it. A count lower than the payload really holds would otherwise parse a
    // prefix of the entries with a perfectly valid checksum — a silent partial
    // load of exactly the kind this validation exists to prevent. (Too high a
    // count instead overruns the buffer, which throws on its own.)
    if (offset !== buf.length) {
      throw new Error(
        `Index length mismatch: consumed ${offset} of ${buf.length} bytes — the entry count or payload is corrupt`
      );
    }

    // Only now, past every check, replace what this index holds: a refused load
    // must leave the caller's existing vectors alone.
    this.entries = entries;

    return {
      entryCount: count,
      dimension: dim,
      embeddingModel: savedModel,
      savedAt: new Date().toISOString(),
      ids,
    };
  }

  /**
   * Save the index to a file on disk.
   *
   * Blocks the event loop for the length of the write, which is proportional to
   * the whole index rather than to whatever changed. Prefer saveToDiskAsync from
   * anywhere that serves live traffic; this variant exists for synchronous
   * callers such as shutdown().
   */
  saveToDisk(filePath: string): void {
    const buf = this.serialize();
    // Claim the target so an async write already in flight — carrying an older
    // snapshot — stands down instead of renaming over this one afterwards.
    this.saveGeneration++;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    // Temp file + rename, matching writeIndexFile — shutdown is the likeliest
    // moment to be killed outright, so it is the last place that should be able
    // to leave a half-written index behind.
    const tmpPath = tempSibling(filePath);
    try {
      fs.writeFileSync(tmpPath, buf);
      fs.renameSync(tmpPath, filePath);
    } catch (err: unknown) {
      try { fs.unlinkSync(tmpPath); } catch { /* nothing to clean up */ }
      throw err;
    }
  }

  /**
   * Save the index to a file on disk without blocking the event loop.
   *
   * Entries are serialized before the first await, so the file holds a snapshot
   * from the moment of the call — concurrent upserts land in the next save rather
   * than corrupting this one.
   *
   * Writes are queued per instance. The synchronous variant serialized callers
   * implicitly by blocking the event loop; without a queue two overlapping saves
   * would race on the target and one caller's snapshot would vanish with both
   * promises still resolving. Queued, each caller's snapshot is written whole and
   * the last one in wins.
   */
  async saveToDiskAsync(filePath: string): Promise<void> {
    const buf = this.serialize();
    const generation = ++this.saveGeneration;

    // A rejected save must not poison the ones queued behind it.
    const write = this.pendingSave
      .catch(() => {})
      .then(() => this.writeIndexFile(filePath, buf, generation));

    this.pendingSave = write.catch(() => {});
    return write;
  }

  /**
   * Write a serialized index to disk atomically.
   *
   * The bytes go to a temp file in the target's own directory — keeping the
   * rename on one filesystem, and therefore atomic — then replace the target. A
   * crash mid-write leaves the previous index readable instead of a truncated
   * one. Visibility is atomic against a process crash; the data is not fsynced,
   * so a power loss can still revert to the previous snapshot. That is fine
   * here: the index is a cache rebuildable from SQLite, and a corrupt or missing
   * one already falls back to a full rebuild.
   */
  private async writeIndexFile(filePath: string, buf: Buffer, generation: number): Promise<void> {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    const tmpPath = tempSibling(filePath);
    try {
      await fs.promises.writeFile(tmpPath, buf);

      // A newer save claimed the target while this one was writing — publishing
      // an older snapshot over it would regress the file. Resolving rather than
      // throwing is correct: the caller's guarantee is that disk is no staler
      // than its call, and a newer save already satisfies that.
      if (generation !== this.saveGeneration) {
        await fs.promises.unlink(tmpPath).catch(() => {});
        return;
      }

      await fs.promises.rename(tmpPath, filePath);
    } catch (err: unknown) {
      await fs.promises.unlink(tmpPath).catch(() => {});
      throw err;
    }
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
