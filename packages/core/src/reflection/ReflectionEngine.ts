import { v4 as uuidv4 } from 'uuid';
import type { Memory } from '../db/schema.js';
import { getReflectionPrompt } from './prompts.js';

export type ReflectionType = 'pattern' | 'knowledge_gap' | 'trend' | 'contradiction_summary';

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
  types: ['pattern', 'knowledge_gap', 'trend', 'contradiction_summary'],
  maxMemoriesToAnalyze: 50,
  minImportance: 0.3,
};

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
    this.config = { ...DEFAULT_REFLECTION_CONFIG, ...config };
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
    this.config = { ...this.config, ...partial };
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
