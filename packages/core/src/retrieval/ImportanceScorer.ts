/**
 * ImportanceScorer — combines multiple signals to rank memories for retrieval.
 *
 * Score = α·similarity + β·recency + γ·importance + δ·accessFreq
 *
 * All factors are normalized to [0, 1]. Weights are tunable.
 */

export interface ScoringInput {
  /** Semantic similarity from vector search (0.0–1.0) */
  similarity: number;
  /** ISO 8601 timestamp of when memory was created */
  createdAt: string;
  /** ISO 8601 timestamp of last access, or null if never accessed */
  lastAccessedAt: string | null;
  /** Stored importance value (0.0–1.0) */
  importance: number;
  /** Total number of times this memory has been accessed */
  accessCount: number;
}

export interface ScoringWeights {
  similarity: number;
  recency: number;
  importance: number;
  accessFreq: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  similarity: 0.45,
  recency: 0.25,
  importance: 0.20,
  accessFreq: 0.10,
};

/**
 * Compute a composite retrieval score for a memory.
 */
export function scoreMemory(
  input: ScoringInput,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
  now: Date = new Date()
): number {
  const recency = recencyScore(input.createdAt, input.lastAccessedAt, now);
  const accessFreq = accessFrequencyScore(input.accessCount);

  return (
    weights.similarity * input.similarity +
    weights.recency * recency +
    weights.importance * input.importance +
    weights.accessFreq * accessFreq
  );
}

/**
 * Recency score using an exponential decay (Ebbinghaus forgetting curve).
 * Returns 1.0 for very recent memories, approaching 0 for old ones.
 *
 * Half-life: ~7 days (604800 seconds)
 */
function recencyScore(
  createdAt: string,
  lastAccessedAt: string | null,
  now: Date
): number {
  const referenceTime = lastAccessedAt
    ? new Date(lastAccessedAt).getTime()
    : new Date(createdAt).getTime();

  const ageMs = now.getTime() - referenceTime;
  const ageSeconds = Math.max(0, ageMs / 1000);

  const HALF_LIFE_SECONDS = 7 * 24 * 3600; // 7 days
  return Math.exp((-Math.LN2 * ageSeconds) / HALF_LIFE_SECONDS);
}

/**
 * Access frequency score — more accessed memories score higher.
 * Uses log scale to prevent domination by very frequently accessed memories.
 */
function accessFrequencyScore(count: number): number {
  if (count <= 0) return 0;
  return Math.min(1.0, Math.log10(count + 1) / 3); // saturates at count≈999
}

/**
 * Boost a memory's importance based on access (reinforcement learning effect).
 * Each access increases importance by a small amount, capped at 1.0.
 */
export function computeImportanceAfterAccess(currentImportance: number): number {
  const boost = 0.02; // 2% boost per access
  return Math.min(1.0, currentImportance + boost);
}

/**
 * Decay a memory's importance over time (forgetting unused memories).
 * Called during background maintenance passes.
 */
export function decayImportance(
  currentImportance: number,
  daysSinceAccess: number
): number {
  const decayRate = 0.01; // 1% per day without access
  const decayed = currentImportance - decayRate * daysSinceAccess;
  return Math.max(0.05, decayed); // never drop below 5%
}
