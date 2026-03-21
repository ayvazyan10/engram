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

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

export async function getEmbedder(): Promise<typeof embedder> {
  if (embedder) return embedder;

  if (!pipeline) {
    const transformers = await import('@xenova/transformers');
    pipeline = transformers.pipeline;
  }

  embedder = await pipeline('feature-extraction', MODEL_ID, {
    quantized: true, // use quantized ONNX model (~25MB vs ~90MB)
  });

  return embedder;
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

export const EMBEDDING_DIMENSION = EMBEDDING_DIM;

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
    // Subnormal or zero
    return (sign << 15) | ((frac >> 13) & 0x3ff);
  }

  const newExp = exp - 127 + 15;
  if (newExp >= 31) return (sign << 15) | 0x7c00; // overflow → Inf
  if (newExp <= 0) return (sign << 15) | (frac >> (14 - newExp) & 0x3ff); // underflow

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
