/**
 * DecayEngine — runs memory decay sweeps and auto-consolidation.
 *
 * This is a stateless, timer-free engine. Callers (REST server, MCP, CLI)
 * are responsible for scheduling. The engine just runs a single pass when asked.
 */

import { and, asc, eq, isNull } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import type { Memory } from '../db/schema.js';
import { computeRetentionScore, decayImportance } from '../retrieval/ImportanceScorer.js';
import type { DecayPolicyConfig } from './DecayPolicy.js';

// ─── Result Types ────────────────────────────────────────────────────────────

export interface DecaySweepResult {
  /** Total memories evaluated */
  scannedCount: number;
  /** Memories archived (soft-deleted) */
  archivedCount: number;
  /** IDs of archived memories */
  archivedIds: string[];
  /** Memories whose importance was reduced but not archived */
  decayedCount: number;
  /** Memories skipped due to protection rules */
  protectedCount: number;
  /** Episodic memories consolidated into semantic */
  consolidatedCount: number;
  /** IDs of new semantic memories from consolidation */
  newSemanticIds: string[];
  /** Sweep duration in milliseconds */
  durationMs: number;
}

// ─── Decay Engine ────────────────────────────────────────────────────────────

export class DecayEngine {
  constructor(private policy: DecayPolicyConfig) {}

  /** Replace the active policy at runtime. */
  updatePolicy(policy: DecayPolicyConfig): void {
    this.policy = policy;
  }

  /** Get the current policy (read-only copy). */
  getPolicy(): DecayPolicyConfig {
    return { ...this.policy };
  }

  /**
   * Check whether a memory is protected from decay.
   */
  isProtected(memory: Memory): boolean {
    return this.policy.protectionRules.some((rule) => rule.predicate(memory));
  }

  /**
   * Compute the retention score for a memory.
   */
  computeRetention(memory: Memory, now: Date = new Date()): number {
    return computeRetentionScore(
      {
        importance: memory.importance ?? 0.5,
        createdAt: memory.createdAt,
        lastAccessedAt: memory.lastAccessedAt,
        accessCount: memory.accessCount ?? 0,
        halfLifeDays: this.policy.halfLifeDays,
      },
      now
    );
  }

  /**
   * Run a full decay sweep.
   *
   * @param forgetFn  Callback to archive a memory (typically brain.forget)
   * @param dryRun    If true, compute results without modifying anything
   */
  async sweep(
    forgetFn: (id: string) => Promise<void>,
    dryRun = false,
    namespace?: string
  ): Promise<DecaySweepResult> {
    const start = Date.now();
    const now = new Date();
    const db = getDb();

    const result: DecaySweepResult = {
      scannedCount: 0,
      archivedCount: 0,
      archivedIds: [],
      decayedCount: 0,
      protectedCount: 0,
      consolidatedCount: 0,
      newSemanticIds: [],
      durationMs: 0,
    };

    // Process in batches, oldest-touched first
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const sweepConditions = [isNull(schema.memories.archivedAt)];
      if (namespace) {
        sweepConditions.push(eq(schema.memories.namespace, namespace));
      }

      const batch = await db
        .select()
        .from(schema.memories)
        .where(and(...sweepConditions))
        .orderBy(asc(schema.memories.lastAccessedAt))
        .limit(this.policy.batchSize)
        .offset(offset);

      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      for (const memory of batch) {
        result.scannedCount++;

        // Check protection rules
        if (this.isProtected(memory)) {
          result.protectedCount++;
          continue;
        }

        const retention = this.computeRetention(memory, now);

        if (retention < this.policy.archiveThreshold) {
          // Archive this memory
          if (!dryRun) {
            await forgetFn(memory.id);
          }
          result.archivedCount++;
          result.archivedIds.push(memory.id);
        } else {
          // Decay importance progressively
          const lastTouch = memory.lastAccessedAt ?? memory.createdAt;
          const daysSince = Math.max(0, (now.getTime() - new Date(lastTouch).getTime()) / (24 * 60 * 60 * 1000));

          if (daysSince > 0) {
            const newImportance = decayImportance(
              memory.importance ?? 0.5,
              daysSince,
              this.policy.importanceDecayRate,
              this.policy.importanceFloor
            );

            if (newImportance < (memory.importance ?? 0.5)) {
              if (!dryRun) {
                await db
                  .update(schema.memories)
                  .set({ importance: newImportance, updatedAt: now.toISOString() })
                  .where(eq(schema.memories.id, memory.id));
              }
              result.decayedCount++;
            }
          }
        }
      }

      if (batch.length < this.policy.batchSize) {
        hasMore = false;
      } else {
        offset += this.policy.batchSize;
      }
    }

    result.durationMs = Date.now() - start;
    return result;
  }

  /**
   * Run auto-consolidation on old episodic memories.
   *
   * @param consolidateFn  Callback to consolidate (typically brain.consolidate)
   * @returns IDs of new semantic memories created
   */
  async autoConsolidate(
    consolidateFn: (minClusterSize: number, threshold: number) => Promise<{ id: string }[]>
  ): Promise<string[]> {
    const config = this.policy.consolidation;
    if (!config.enabled) return [];

    const db = getDb();

    // Count episodic memories older than the minimum age
    const cutoff = new Date(Date.now() - config.minEpisodicAgeMs).toISOString();
    const oldEpisodes = await db
      .select()
      .from(schema.memories)
      .where(
        and(
          eq(schema.memories.type, 'episodic'),
          isNull(schema.memories.archivedAt)
        )
      );

    // Filter to only episodes old enough
    const eligible = oldEpisodes.filter(
      (m) => new Date(m.createdAt).getTime() < new Date(cutoff).getTime()
    );

    if (eligible.length < config.minClusterSize) return [];

    const results = await consolidateFn(config.minClusterSize, config.similarityThreshold);
    return results.map((m) => m.id);
  }
}
