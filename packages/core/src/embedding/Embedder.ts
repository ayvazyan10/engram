/**
 * Embedder — wraps @xenova/transformers for local WASM-based text embeddings.
 *
 * Uses Xenova/all-MiniLM-L6-v2 (384-dim) — ~25MB download, cached after first use.
 * No server round-trip required; runs entirely in Node.js via ONNX/WASM.
 */

// Dynamic import to support both CommonJS and ESM environments
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipeline: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embedder: any = null;

/** Default embedding model. Can be overridden via ENGRAM_EMBEDDING_MODEL env var. */
const DEFAULT_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_EMBEDDING_DIM = 384;

/** Active model ID (resolved at first embed call). */
let activeModelId: string = process.env['ENGRAM_EMBEDDING_MODEL'] ?? DEFAULT_MODEL_ID;

/** Known model → dimension mappings. */
const MODEL_DIMENSIONS: Record<string, number> = {
  'Xenova/all-MiniLM-L6-v2': 384,
  'Xenova/all-MiniLM-L12-v2': 384,
  'Xenova/bge-small-en-v1.5': 384,
  'Xenova/bge-base-en-v1.5': 768,
  'Xenova/gte-small': 384,
  'Xenova/gte-base': 768,
};

const EMBEDDING_DIM = MODEL_DIMENSIONS[activeModelId] ?? DEFAULT_EMBEDDING_DIM;

/**
 * In-flight load, memoized so concurrent callers share one model load.
 * Without this, N simultaneous first embed() calls each downloaded and
 * instantiated the model, and a switchEmbeddingModel racing them could bind the
 * wrong model.
 */
let embedderLoading: Promise<typeof embedder> | null = null;

export async function getEmbedder(): Promise<typeof embedder> {
  if (embedder) return embedder;
  if (embedderLoading) return embedderLoading;

  const loadingFor = activeModelId;

  const load = (async () => {
    if (!pipeline) {
      const transformers = await import('@xenova/transformers');
      pipeline = transformers.pipeline;
    }

    const loaded = await pipeline('feature-extraction', loadingFor, {
      quantized: true, // use quantized ONNX model (~25MB vs ~90MB)
    });

    // The active model was switched while this load was running. The result was
    // already correctly kept out of the cache — but it was still handed back to
    // every caller waiting on it, and store() then tagged the resulting vector
    // with the NEW model id, so the row claimed a model that never produced it.
    // Load the model that is actually active instead.
    //
    // Safe to recurse: switchEmbeddingModel is the only thing that can move
    // activeModelId, and it clears embedderLoading, so this call starts a fresh
    // load rather than awaiting itself.
    if (loadingFor !== activeModelId) return getEmbedder();

    embedder = loaded;
    return loaded;
  })();

  embedderLoading = load;

  try {
    return await load;
  } finally {
    // Only if it is still ours: switchEmbeddingModel, or the retry above, may
    // have put a newer load in this slot, and clearing that one would let the
    // next caller start a duplicate load of the same model.
    if (embedderLoading === load) embedderLoading = null;
  }
}

/**
 * Embed a single text string into a Float32Array of length 384.
 */
export async function embed(text: string): Promise<Float32Array> {
  const pipe = await getEmbedder();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return output.data as Float32Array;
}

/**
 * Embed multiple texts in batch. More efficient than calling embed() in a loop.
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const pipe = await getEmbedder();
  const results: Float32Array[] = [];

  // Process in batches of 32 for memory efficiency
  const BATCH_SIZE = 32;
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const outputs = await Promise.all(
      batch.map((t) => pipe(t, { pooling: 'mean', normalize: true }))
    );
    results.push(...outputs.map((o: { data: Float32Array }) => o.data as Float32Array));
  }

  return results;
}

/**
 * Dimension of the DEFAULT model, frozen at module load.
 *
 * @deprecated Prefer {@link getEmbeddingDimension} — this constant does not
 * follow switchEmbeddingModel, so using it after a model switch silently
 * desyncs the vector index from the vectors actually being produced.
 */
export const EMBEDDING_DIMENSION = EMBEDDING_DIM;

/** Dimension of the CURRENTLY ACTIVE embedding model. */
export function getEmbeddingDimension(): number {
  return getModelDimension();
}

/** Get the currently active embedding model ID. */
export function getEmbeddingModelId(): string {
  return activeModelId;
}

/** Get the dimension for a given model ID, or the current model's dimension. */
export function getModelDimension(modelId?: string): number {
  return MODEL_DIMENSIONS[modelId ?? activeModelId] ?? DEFAULT_EMBEDDING_DIM;
}

/**
 * Switch the active embedding model at runtime.
 * Clears the cached embedder so the next embed() call loads the new model.
 * Returns the new dimension for the model.
 */
export function switchEmbeddingModel(modelId: string): number {
  activeModelId = modelId;
  embedder = null; // force reload on next embed()
  embedderLoading = null; // abandon any in-flight load of the previous model
  return MODEL_DIMENSIONS[modelId] ?? DEFAULT_EMBEDDING_DIM;
}

/** All known model IDs and their dimensions. */
export { MODEL_DIMENSIONS };

// ─── FP16 compression utilities ──────────────────────────────────────────────

/**
 * Pack a Float32Array into a Buffer using FP16 (half-precision).
 * Reduces storage from 1536 bytes (384×4) to 768 bytes (384×2) — 2x compression.
 */
export function packFP16(f32: Float32Array): Buffer {
  const buf = Buffer.allocUnsafe(f32.length * 2);
  for (let i = 0; i < f32.length; i++) {
    buf.writeUInt16LE(float32ToFloat16(f32[i] ?? 0), i * 2);
  }
  return buf;
}

/**
 * Unpack a FP16 Buffer back into a Float32Array.
 */
export function unpackFP16(buf: Buffer): Float32Array {
  const f32 = new Float32Array(buf.length / 2);
  for (let i = 0; i < f32.length; i++) {
    f32[i] = float16ToFloat32(buf.readUInt16LE(i * 2));
  }
  return f32;
}

function float32ToFloat16(val: number): number {
  const f32 = new Float32Array(1);
  f32[0] = val;
  const u32 = new Uint32Array(f32.buffer)[0] ?? 0;

  const sign = (u32 >> 31) & 0x1;
  const exp = (u32 >> 23) & 0xff;
  const frac = u32 & 0x7fffff;

  if (exp === 0xff) {
    // NaN or Inf
    return (sign << 15) | 0x7c00 | (frac ? 0x200 : 0);
  }
  if (exp === 0) {
    // An FP32 subnormal (or zero): |value| < 2^-126, which is many orders of
    // magnitude below the smallest FP16 subnormal (2^-24), so the only faithful
    // FP16 result is signed zero. Emitting `frac >> 13` as an FP16 subnormal
    // mantissa reinterpreted a value of frac x 2^-149 as (frac >> 13) x 2^-24
    // instead — turning 1e-40 into 4.77e-7, a number seventeen decades too big.
    return sign << 15;
  }

  const newExp = exp - 127 + 15;
  if (newExp >= 31) return (sign << 15) | 0x7c00; // overflow → Inf

  if (newExp <= 0) {
    // Underflow into the FP16 subnormal range. A normal FP32 significand is
    // 1.frac — the implicit leading 1 (0x800000) must be restored before
    // shifting, otherwise the most significant mantissa bit is dropped and
    // values like 2^-15 collapse to zero.
    const shift = 14 - newExp;
    if (shift >= 32) return sign << 15; // below the smallest subnormal → signed zero
    return (sign << 15) | (((frac | 0x800000) >> shift) & 0x3ff);
  }

  return (sign << 15) | (newExp << 10) | (frac >> 13);
}

function float16ToFloat32(val: number): number {
  const sign = (val >> 15) & 0x1;
  const exp = (val >> 10) & 0x1f;
  const frac = val & 0x3ff;

  let f32: number;
  if (exp === 0) {
    f32 = frac === 0 ? 0 : frac * Math.pow(2, -24);
  } else if (exp === 31) {
    f32 = frac ? NaN : Infinity;
  } else {
    f32 = (1 + frac / 1024) * Math.pow(2, exp - 15);
  }

  return sign ? -f32 : f32;
}
