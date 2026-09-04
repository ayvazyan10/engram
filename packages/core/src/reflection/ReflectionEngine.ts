import { v4 as uuidv4 } from 'uuid';
import type { Memory } from '../db/schema.js';
import {
  assertBoolean,
  assertNonEmptyArrayOf,
  assertNoUnknownKeys,
  assertNumberInRange,
  assertPlainObject,
} from '../lifecycle/configValidation.js';
import type { NumericRange } from '../lifecycle/configValidation.js';
import { getReflectionPrompt } from './prompts.js';

export type ReflectionType = 'pattern' | 'knowledge_gap' | 'trend' | 'contradiction_summary';

/** Every reflection type, as runtime values a caller's input can be checked against. */
export const REFLECTION_TYPES: readonly ReflectionType[] = [
  'pattern',
  'knowledge_gap',
  'trend',
  'contradiction_summary',
];

export interface ReflectionConfig {
  enabled: boolean;
  storeCountThreshold: number;
  triggerOnDecay: boolean;
  types: ReflectionType[];
  maxMemoriesToAnalyze: number;
  minImportance: number;
}

export const DEFAULT_REFLECTION_CONFIG: ReflectionConfig = {
  enabled: true,
  storeCountThreshold: 10,
  triggerOnDecay: true,
  types: [...REFLECTION_TYPES],
  maxMemoriesToAnalyze: 50,
  minImportance: 0.3,
};

// ─── Validation ──────────────────────────────────────────────────────────────

/** Names this config in every validation message. */
const LABEL = 'reflection config';

/**
 * Bounds every merged config has to satisfy.
 *
 * As with the decay policy, these are not tuning advice — an out-of-range value
 * does not fail where it is set:
 *
 *   - `maxMemoriesToAnalyze` becomes the LIMIT of the query
 *     NeuralBrain.getReflectionTasks() runs, and SQLite answers a fractional
 *     LIMIT with SQLITE_MISMATCH: every later reflection request fails, from a
 *     value the caller set successfully long before.
 *   - `storeCountThreshold` of 0 or less makes notifyStore() report reflection
 *     due on every single store, forever.
 */
const REFLECTION_RANGES = {
  storeCountThreshold: { min: 1, max: 1_000_000, integer: true },
  maxMemoriesToAnalyze: { min: 1, max: 10_000, integer: true },
  minImportance: { min: 0, max: 1 },
} as const satisfies Record<string, NumericRange>;

const REFLECTION_KEYS: readonly string[] = [
  ...Object.keys(REFLECTION_RANGES),
  'enabled',
  'triggerOnDecay',
  'types',
];

/**
 * Merge a partial config over a base and validate the result.
 *
 * Fields are copied one by one rather than spread, so an unknown key or an
 * explicit `undefined` cannot reach the engine — and `types` is copied rather
 * than aliased, so neither the caller's array nor the module-level default can
 * be mutated through the engine afterwards.
 *
 * Throws on anything the engine could not work with, leaving the caller with
 * the config it already had. Without this, `types` in particular was accepted
 * as any value at all and then threw from `this.config.types.map(...)` inside
 * buildTasks — far from the call that caused it, and taking the MCP
 * `request_reflection` tool down with it.
 */
export function mergeReflectionConfig(
  partial: Partial<ReflectionConfig>,
  base: ReflectionConfig = DEFAULT_REFLECTION_CONFIG,
): ReflectionConfig {
  assertNoUnknownKeys(LABEL, assertPlainObject(LABEL, partial), REFLECTION_KEYS);

  const merged: ReflectionConfig = {
    enabled: partial.enabled ?? base.enabled,
    storeCountThreshold: partial.storeCountThreshold ?? base.storeCountThreshold,
    triggerOnDecay: partial.triggerOnDecay ?? base.triggerOnDecay,
    types: [...(partial.types ?? base.types)],
    maxMemoriesToAnalyze: partial.maxMemoriesToAnalyze ?? base.maxMemoriesToAnalyze,
    minImportance: partial.minImportance ?? base.minImportance,
  };

  assertBoolean(LABEL, 'enabled', merged.enabled);
  assertBoolean(LABEL, 'triggerOnDecay', merged.triggerOnDecay);
  assertNonEmptyArrayOf(LABEL, 'types', partial.types ?? base.types, REFLECTION_TYPES);
  for (const [field, range] of Object.entries(REFLECTION_RANGES)) {
    assertNumberInRange(LABEL, field, merged[field as keyof typeof REFLECTION_RANGES], range as NumericRange);
  }

  return merged;
}

export interface ReflectionStats {
  total: number;
  byType: Record<string, number>;
}

/**
 * A reasoning task handed to the AI connected to Engram. Engram itself never
 * runs an LLM — it selects the memories, builds the prompt, and lets the
 * consuming AI produce the actual insight (see {@link ReflectionResult}).
 */
export interface ReflectionTask {
  type: ReflectionType;
  prompt: string;
  relatedMemoryIds: string[];
  stats: ReflectionStats;
}

/** An insight produced by the connected AI, ready to be stored. */
export interface ReflectionResult {
  id: string;
  type: ReflectionType;
  insight: string;
  confidence: number;
  relatedMemoryIds: string[];
  createdAt: string;
}

export interface ReflectionStatus {
  enabled: boolean;
  due: boolean;
  counter: number;
  threshold: number;
}

/**
 * The reflection engine is a planner + scheduler, not an LLM client. It decides
 * WHEN reflection is due (store-count / decay triggers) and WHAT to reflect on
 * (memory selection + prompt building). The connected AI does the reasoning and
 * writes results back via `buildResult` → store.
 */
export class ReflectionEngine {
  private storeCounter = 0;
  private due = false;
  private config: ReflectionConfig;

  constructor(config?: Partial<ReflectionConfig>) {
    // Validated here too, not only in updateConfig: a config rejected at
    // construction is a caller error reported at the call, rather than an
    // engine that looks fine until the first reflection request.
    this.config = mergeReflectionConfig(config ?? {});
  }

  /** Count a store event. Returns true (and marks reflection due) at the threshold. */
  notifyStore(): boolean {
    if (!this.config.enabled) return false;
    this.storeCounter++;
    if (this.storeCounter >= this.config.storeCountThreshold) {
      this.storeCounter = 0;
      this.due = true;
      return true;
    }
    return false;
  }

  /** Signal a decay sweep. Returns true (and marks reflection due) when configured. */
  notifyDecay(): boolean {
    if (!(this.config.enabled && this.config.triggerOnDecay)) return false;
    this.due = true;
    return true;
  }

  /** Whether a reflection cycle is pending for the connected AI to pick up. */
  isReflectionDue(): boolean {
    return this.config.enabled && this.due;
  }

  /** Clear the pending flag (called once the AI has pulled the reflection tasks). */
  clearPending(): void {
    this.due = false;
  }

  getStatus(): ReflectionStatus {
    return {
      enabled: this.config.enabled,
      due: this.isReflectionDue(),
      counter: this.storeCounter,
      threshold: this.config.storeCountThreshold,
    };
  }

  /**
   * Build reasoning tasks from candidate memories. Pure and deterministic — no
   * network, no LLM. The connected AI consumes these prompts and produces
   * insights via {@link buildResult}.
   */
  buildTasks(memories: Memory[]): ReflectionTask[] {
    const filtered = memories.filter(
      (m) => (m.importance ?? 0) >= this.config.minImportance && !m.archivedAt,
    );

    if (filtered.length < 3) return [];

    const stats: ReflectionStats = {
      total: filtered.length,
      byType: filtered.reduce<Record<string, number>>((acc, m) => {
        acc[m.type] = (acc[m.type] ?? 0) + 1;
        return acc;
      }, {}),
    };

    const memorySummary = filtered
      .slice(0, this.config.maxMemoriesToAnalyze)
      .map((m) => {
        const date = m.createdAt ? ` [${m.createdAt.split('T')[0]}]` : '';
        const source = m.source ? ` (${m.source})` : '';
        return `• [${m.type}]${date}${source}: ${m.content.slice(0, 200)}`;
      })
      .join('\n');

    const relatedMemoryIds = filtered.slice(0, 5).map((m) => m.id);

    return this.config.types.map((type) => ({
      type,
      prompt: getReflectionPrompt(type, memorySummary, stats),
      relatedMemoryIds,
      stats,
    }));
  }

  /**
   * Turn an AI-provided insight into a storable result. Returns null for empty
   * or NO_INSIGHT responses. Confidence is AI-supplied when available, otherwise
   * derived from a light heuristic.
   */
  buildResult(
    type: ReflectionType,
    insight: string,
    relatedMemoryIds: string[] = [],
    confidence?: number,
  ): ReflectionResult | null {
    const text = insight.trim();
    if (!text || text.includes('NO_INSIGHT')) return null;

    return {
      id: uuidv4(),
      type,
      insight: text,
      confidence: confidence ?? this.computeConfidence(text, relatedMemoryIds.length),
      relatedMemoryIds,
      createdAt: new Date().toISOString(),
    };
  }

  resetCounter(): void {
    this.storeCounter = 0;
  }

  getCounter(): number {
    return this.storeCounter;
  }

  getConfig(): ReflectionConfig {
    return { ...this.config };
  }

  updateConfig(partial: Partial<ReflectionConfig>): void {
    // Merged and validated before assignment, so a rejected update leaves the
    // previous config exactly as it was. The bare spread this replaces took
    // whatever it was handed — a bare JSON string became config keys "0", "1",
    // "2" — and in-process callers (MCP tools, library consumers) never pass
    // through the REST schema that now guards the HTTP surface.
    this.config = mergeReflectionConfig(partial, this.config);
  }

  private computeConfidence(insight: string, memoryCount: number): number {
    let confidence = 0.5;
    if (memoryCount > 20) confidence += 0.1;
    if (memoryCount > 50) confidence += 0.1;
    if (insight.length > 100) confidence += 0.1;
    if (insight.length > 200) confidence += 0.05;
    return Math.min(0.95, confidence);
  }
}
