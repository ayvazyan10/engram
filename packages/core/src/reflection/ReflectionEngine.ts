import { v4 as uuidv4 } from 'uuid';
import type { LLMProvider } from '../llm/LLMProvider.js';
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

export interface ReflectionResult {
  id: string;
  type: ReflectionType;
  insight: string;
  confidence: number;
  relatedMemoryIds: string[];
  createdAt: string;
}

export class ReflectionEngine {
  private storeCounter = 0;
  private config: ReflectionConfig;
  private llmProvider: LLMProvider;

  constructor(llmProvider: LLMProvider, config?: Partial<ReflectionConfig>) {
    this.llmProvider = llmProvider;
    this.config = { ...DEFAULT_REFLECTION_CONFIG, ...config };
  }

  notifyStore(): boolean {
    if (!this.config.enabled) return false;
    this.storeCounter++;
    if (this.storeCounter >= this.config.storeCountThreshold) {
      this.storeCounter = 0;
      return true;
    }
    return false;
  }

  notifyDecay(): boolean {
    return this.config.enabled && this.config.triggerOnDecay;
  }

  async reflect(memories: Memory[]): Promise<ReflectionResult[]> {
    const available = await this.llmProvider.isAvailable();
    if (!available) return [];

    const filtered = memories.filter(
      (m) => (m.importance ?? 0) >= this.config.minImportance && !m.archivedAt,
    );

    if (filtered.length < 3) return [];

    const stats = {
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

    const results: ReflectionResult[] = [];

    for (const type of this.config.types) {
      const result = await this.reflectType(type, filtered, memorySummary, stats);
      if (result) results.push(result);
    }

    return results;
  }

  async reflectType(
    type: ReflectionType,
    memories: Memory[],
    memorySummary?: string,
    stats?: { total: number; byType: Record<string, number> },
  ): Promise<ReflectionResult | null> {
    const available = await this.llmProvider.isAvailable();
    if (!available) return null;

    const effectiveStats = stats ?? {
      total: memories.length,
      byType: memories.reduce<Record<string, number>>((acc, m) => {
        acc[m.type] = (acc[m.type] ?? 0) + 1;
        return acc;
      }, {}),
    };

    const effectiveSummary = memorySummary ?? memories
      .slice(0, this.config.maxMemoriesToAnalyze)
      .map((m) => `• [${m.type}]: ${m.content.slice(0, 200)}`)
      .join('\n');

    const prompt = getReflectionPrompt(type, effectiveSummary, effectiveStats);

    try {
      const completion = await this.llmProvider.complete(
        [{ role: 'user', content: prompt }],
        { maxTokens: 200, temperature: 0.4 },
      );

      const insight = completion.content.trim();
      if (!insight || insight === 'NO_INSIGHT' || insight.includes('NO_INSIGHT')) {
        return null;
      }

      const relatedIds = memories.slice(0, 5).map((m) => m.id);

      return {
        id: uuidv4(),
        type,
        insight,
        confidence: this.computeConfidence(insight, memories.length),
        relatedMemoryIds: relatedIds,
        createdAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
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
