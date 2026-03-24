/**
 * ContradictionDetector — identifies when new memories conflict with existing ones.
 *
 * How it works:
 *   1. When a new memory is stored, find highly similar existing memories (same topic).
 *   2. Analyze content for negation/contradiction signals.
 *   3. If contradictions are found, flag them with resolution strategies.
 *
 * This is a heuristic system — it uses embedding similarity to find candidates,
 * then pattern-based content analysis to detect actual contradictions. No LLM needed.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import type { Memory, MemoryType } from '../db/schema.js';
import { embed, unpackFP16 } from '../embedding/Embedder.js';
import type { VectorSearch } from '../retrieval/VectorSearch.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ResolutionStrategy =
  | 'keep_newest'    // Archive the old memory, keep the new one
  | 'keep_oldest'    // Keep the old memory, archive the new one
  | 'keep_important' // Keep whichever has higher importance
  | 'keep_both'      // Keep both but link them with 'contradicts' edge
  | 'manual';        // Flag for human review, take no action

export interface Contradiction {
  /** The new memory that triggered the contradiction */
  newMemoryId: string;
  /** The existing memory it contradicts */
  existingMemoryId: string;
  /** Cosine similarity between the two (high = same topic) */
  similarity: number;
  /** Contradiction confidence score (0.0–1.0) */
  confidence: number;
  /** Signals that contributed to the detection */
  signals: ContradictionSignal[];
  /** Suggested resolution strategy */
  suggestedStrategy: ResolutionStrategy;
}

export interface ContradictionSignal {
  /** Signal type */
  type: 'negation' | 'value_change' | 'temporal_override' | 'opposite_sentiment';
  /** Human-readable description */
  description: string;
  /** How much this signal contributed (0.0–1.0) */
  weight: number;
}

export interface ContradictionCheckResult {
  /** Whether any contradictions were found */
  hasContradictions: boolean;
  /** List of detected contradictions, ordered by confidence */
  contradictions: Contradiction[];
  /** How many candidate memories were evaluated */
  candidatesChecked: number;
  /** Check duration in milliseconds */
  latencyMs: number;
}

export interface ContradictionConfig {
  /** Enable/disable contradiction checking on store (default: true) */
  enabled: boolean;
  /** Minimum similarity to consider two memories as same-topic candidates (default: 0.65) */
  similarityThreshold: number;
  /** Minimum contradiction confidence to flag (default: 0.4) */
  confidenceThreshold: number;
  /** Maximum number of candidate memories to evaluate (default: 10) */
  maxCandidates: number;
  /** Default resolution strategy when auto-resolving (default: 'keep_both') */
  defaultStrategy: ResolutionStrategy;
  /** If true, auto-resolve contradictions using the default strategy (default: false) */
  autoResolve: boolean;
}

export const DEFAULT_CONTRADICTION_CONFIG: ContradictionConfig = {
  enabled: true,
  similarityThreshold: 0.65,
  confidenceThreshold: 0.4,
  maxCandidates: 10,
  defaultStrategy: 'keep_both',
  autoResolve: false,
};

// ─── Negation & Contradiction Patterns ───────────────────────────────────────

/** Words/phrases that negate or reverse meaning. */
const NEGATION_WORDS = new Set([
  'not', 'no', 'never', 'none', 'neither', 'nor', 'nothing',
  'nowhere', 'nobody', 'cannot', "can't", "don't", "doesn't",
  "didn't", "won't", "wouldn't", "shouldn't", "couldn't", "isn't",
  "aren't", "wasn't", "weren't", "hasn't", "haven't", "hadn't",
]);

/** Patterns that indicate value/state changes. */
const CHANGE_PATTERNS = [
  /(?:changed|updated|switched|migrated|moved|renamed)\s+(?:from|to)\b/i,
  /(?:no longer|not anymore|stopped|quit|dropped|removed|replaced)\b/i,
  /(?:instead of|rather than|as opposed to)\b/i,
  /(?:previously|formerly|used to|was|were)\s+.*?(?:now|currently|today)\b/i,
  /(?:now|currently|today)\s+.*?(?:previously|formerly|used to|was|were)\b/i,
];

/** Opposite sentiment pairs. */
const SENTIMENT_OPPOSITES: Array<[RegExp, RegExp]> = [
  [/\b(?:likes?|loves?|prefers?|enjoys?|favou?rs?)\b/i, /\b(?:hates?|dislikes?|avoids?|despises?)\b/i],
  [/\b(?:enabled?|active|on|true|yes)\b/i, /\b(?:disabled?|inactive|off|false|no)\b/i],
  [/\b(?:good|great|excellent|positive)\b/i, /\b(?:bad|terrible|awful|negative)\b/i],
  [/\b(?:correct|right|accurate|true)\b/i, /\b(?:incorrect|wrong|inaccurate|false)\b/i],
  [/\b(?:allow|permit|accept)\b/i, /\b(?:deny|reject|refuse|block|forbid)\b/i],
  [/\b(?:increase|raise|grow|more)\b/i, /\b(?:decrease|lower|shrink|less|fewer)\b/i],
];

// ─── Detector ────────────────────────────────────────────────────────────────

export class ContradictionDetector {
  private config: ContradictionConfig;

  constructor(config: Partial<ContradictionConfig> = {}) {
    this.config = { ...DEFAULT_CONTRADICTION_CONFIG, ...config };
  }

  /** Get the current config. */
  getConfig(): ContradictionConfig {
    return { ...this.config };
  }

  /** Update config at runtime. */
  updateConfig(partial: Partial<ContradictionConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /**
   * Check a new memory's content against existing memories for contradictions.
   *
   * @param newContent    The text of the new memory
   * @param newEmbedding  Pre-computed embedding vector for the new memory
   * @param newMemoryId   ID of the newly stored memory
   * @param vectorSearch  Vector search index for finding candidates
   * @param namespace     Current namespace scope (optional)
   */
  async check(
    newContent: string,
    newEmbedding: Float32Array,
    newMemoryId: string,
    vectorSearch: VectorSearch,
    namespace?: string | null,
  ): Promise<ContradictionCheckResult> {
    const start = Date.now();

    if (!this.config.enabled) {
      return { hasContradictions: false, contradictions: [], candidatesChecked: 0, latencyMs: 0 };
    }

    // Step 1: Find same-topic candidates via vector similarity
    const candidates = vectorSearch.search(
      newEmbedding,
      this.config.maxCandidates + 1, // +1 to account for self
      this.config.similarityThreshold,
      undefined, // all types
      namespace,
    );

    // Exclude self
    const others = candidates.filter((c) => c.id !== newMemoryId);

    if (others.length === 0) {
      return { hasContradictions: false, contradictions: [], candidatesChecked: 0, latencyMs: Date.now() - start };
    }

    // Step 2: Load candidate memory contents from DB
    const db = getDb();
    const contradictions: Contradiction[] = [];

    for (const candidate of others) {
      const [existing] = await db
        .select()
        .from(schema.memories)
        .where(and(eq(schema.memories.id, candidate.id), isNull(schema.memories.archivedAt)))
        .limit(1);

      if (!existing) continue;

      // Step 3: Analyze content for contradiction signals
      const signals = this.analyzeContradiction(newContent, existing.content);
      const confidence = this.computeConfidence(signals, candidate.similarity);

      if (confidence >= this.config.confidenceThreshold) {
        contradictions.push({
          newMemoryId,
          existingMemoryId: existing.id,
          similarity: Math.round(candidate.similarity * 1000) / 1000,
          confidence: Math.round(confidence * 1000) / 1000,
          signals,
          suggestedStrategy: this.suggestStrategy(existing, confidence),
        });
      }
    }

    // Sort by confidence descending
    contradictions.sort((a, b) => b.confidence - a.confidence);

    return {
      hasContradictions: contradictions.length > 0,
      contradictions,
      candidatesChecked: others.length,
      latencyMs: Date.now() - start,
    };
  }

  /**
   * Analyze two pieces of content for contradiction signals.
   */
  analyzeContradiction(newContent: string, existingContent: string): ContradictionSignal[] {
    const signals: ContradictionSignal[] = [];

    // Signal 1: Negation — one text negates what the other states
    const negationScore = this.detectNegation(newContent, existingContent);
    if (negationScore > 0) {
      signals.push({
        type: 'negation',
        description: 'Content contains negation of existing statement',
        weight: negationScore,
      });
    }

    // Signal 2: Value change — explicit "changed from X to Y" patterns
    const changeScore = this.detectValueChange(newContent, existingContent);
    if (changeScore > 0) {
      signals.push({
        type: 'value_change',
        description: 'Content indicates a value or state change',
        weight: changeScore,
      });
    }

    // Signal 3: Temporal override — newer info supersedes older
    const temporalScore = this.detectTemporalOverride(newContent, existingContent);
    if (temporalScore > 0) {
      signals.push({
        type: 'temporal_override',
        description: 'Newer content appears to update/override older information',
        weight: temporalScore,
      });
    }

    // Signal 4: Opposite sentiment — "likes X" vs "hates X"
    const sentimentScore = this.detectOppositeSentiment(newContent, existingContent);
    if (sentimentScore > 0) {
      signals.push({
        type: 'opposite_sentiment',
        description: 'Content expresses opposite sentiment about the same subject',
        weight: sentimentScore,
      });
    }

    return signals;
  }

  // ─── Signal Detection Methods ──────────────────────────────────────────────

  /**
   * Detect negation between two texts.
   * Compares word overlap, looking for cases where one text negates
   * a statement in the other.
   */
  private detectNegation(a: string, b: string): number {
    const wordsA = this.tokenize(a);
    const wordsB = this.tokenize(b);

    // Count negation words in each
    const negA = wordsA.filter((w) => NEGATION_WORDS.has(w)).length;
    const negB = wordsB.filter((w) => NEGATION_WORDS.has(w)).length;

    // Content words (non-negation, non-stop)
    const contentA = new Set(wordsA.filter((w) => !NEGATION_WORDS.has(w) && w.length > 3));
    const contentB = new Set(wordsB.filter((w) => !NEGATION_WORDS.has(w) && w.length > 3));

    // High overlap in content words but different negation counts = likely contradiction
    const overlap = [...contentA].filter((w) => contentB.has(w)).length;
    const maxContent = Math.max(contentA.size, contentB.size, 1);
    const overlapRatio = overlap / maxContent;

    // If one has negation and the other doesn't (or different counts), with high overlap
    if (overlapRatio > 0.3 && negA !== negB) {
      return Math.min(1.0, overlapRatio * 0.8 + 0.2);
    }

    return 0;
  }

  /**
   * Detect explicit value/state change patterns.
   */
  private detectValueChange(a: string, b: string): number {
    const combined = a + ' ' + b;
    let score = 0;

    for (const pattern of CHANGE_PATTERNS) {
      if (pattern.test(a) || pattern.test(b)) {
        score += 0.3;
      }
    }

    return Math.min(1.0, score);
  }

  /**
   * Detect temporal override signals.
   * Looks for "now X" vs "was Y" or explicit date comparisons.
   */
  private detectTemporalOverride(newContent: string, existingContent: string): number {
    const temporalNew = /\b(now|currently|today|as of|starting|going forward)\b/i.test(newContent);
    const temporalOld = /\b(was|were|used to|previously|formerly|before)\b/i.test(existingContent);

    if (temporalNew && temporalOld) return 0.6;
    if (temporalNew) return 0.3;
    return 0;
  }

  /**
   * Detect opposite sentiment about the same subject.
   */
  private detectOppositeSentiment(a: string, b: string): number {
    let score = 0;

    for (const [positive, negative] of SENTIMENT_OPPOSITES) {
      const aPos = positive.test(a);
      const aNeg = negative.test(a);
      const bPos = positive.test(b);
      const bNeg = negative.test(b);

      // One positive, the other negative = contradiction
      if ((aPos && bNeg) || (aNeg && bPos)) {
        score += 0.5;
      }
    }

    return Math.min(1.0, score);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Compute overall contradiction confidence from signals and similarity.
   */
  private computeConfidence(signals: ContradictionSignal[], similarity: number): number {
    if (signals.length === 0) return 0;

    // Weighted average of signal weights
    const signalScore = signals.reduce((sum, s) => sum + s.weight, 0) / signals.length;

    // Higher similarity means they're about the same topic — amplifies contradiction
    // Similarity above threshold is already guaranteed, so normalize to 0–1 range above threshold
    const topicRelevance = Math.min(1.0, (similarity - this.config.similarityThreshold) / (1 - this.config.similarityThreshold));

    // Final confidence = signal strength × topic relevance, with signal count bonus
    const countBonus = Math.min(0.2, signals.length * 0.05);
    return Math.min(1.0, signalScore * (0.6 + 0.4 * topicRelevance) + countBonus);
  }

  /**
   * Suggest a resolution strategy based on the existing memory and confidence.
   */
  private suggestStrategy(existing: Memory, confidence: number): ResolutionStrategy {
    // High confidence + semantic memory = likely a fact update → keep newest
    if (confidence > 0.7 && existing.type === 'semantic') {
      return 'keep_newest';
    }

    // High importance existing memory → keep both and let human decide
    if ((existing.importance ?? 0.5) >= 0.8) {
      return 'keep_both';
    }

    // Moderate confidence → keep both
    if (confidence < 0.6) {
      return 'keep_both';
    }

    return this.config.defaultStrategy;
  }

  /**
   * Tokenize text into lowercase words.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9']/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 0);
  }
}
