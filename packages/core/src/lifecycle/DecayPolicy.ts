/**
 * DecayPolicy — configuration for memory decay and garbage collection.
 *
 * Controls how memories age, when they get archived, and when
 * auto-consolidation kicks in. Think of it as the brain's sleep
 * and forgetting parameters.
 */

import type { Memory } from '../db/schema.js';

// ─── Protection Rules ────────────────────────────────────────────────────────

export interface ProtectionRule {
  /** Human-readable name for this rule */
  name: string;
  /** Return true if the memory should be protected from decay */
  predicate: (memory: Memory) => boolean;
}

/** Default rules that prevent important memories from being archived. */
export const DEFAULT_PROTECTION_RULES: ProtectionRule[] = [
  {
    name: 'high-importance-semantic',
    predicate: (m) => m.type === 'semantic' && (m.importance ?? 0) >= 0.8,
  },
  {
    name: 'high-confidence-procedural',
    predicate: (m) => m.type === 'procedural' && (m.confidence ?? 0) >= 0.9,
  },
  {
    name: 'recently-accessed',
    predicate: (m) => {
      if (!m.lastAccessedAt) return false;
      const oneDayMs = 24 * 60 * 60 * 1000;
      return Date.now() - new Date(m.lastAccessedAt).getTime() < oneDayMs;
    },
  },
  {
    name: 'pinned-or-protected',
    predicate: (m) => {
      try {
        const tags: string[] = typeof m.tags === 'string' ? JSON.parse(m.tags) : m.tags ?? [];
        return tags.includes('pinned') || tags.includes('protected');
      } catch {
        return false;
      }
    },
  },
];

// ─── Consolidation Config ────────────────────────────────────────────────────

export interface ConsolidationConfig {
  /** Whether auto-consolidation runs after each decay sweep */
  enabled: boolean;
  /** Minimum episodic memories to form a cluster */
  minClusterSize: number;
  /** Similarity threshold for clustering */
  similarityThreshold: number;
  /** Only consolidate episodes older than this (ms) */
  minEpisodicAgeMs: number;
}

const DEFAULT_CONSOLIDATION: ConsolidationConfig = {
  enabled: true,
  minClusterSize: 3,
  similarityThreshold: 0.6,
  minEpisodicAgeMs: 24 * 60 * 60 * 1000, // 24 hours
};

// ─── Decay Policy ────────────────────────────────────────────────────────────

export interface DecayPolicyConfig {
  /** Ebbinghaus half-life in days (default: 7) */
  halfLifeDays: number;
  /** Retention score below which a memory is archived (default: 0.05) */
  archiveThreshold: number;
  /** How often to run decay sweep in ms (default: 1 hour, 0 = disabled) */
  decayIntervalMs: number;
  /** How many memories to evaluate per batch (default: 200) */
  batchSize: number;
  /** Daily importance reduction rate for unused memories (default: 0.01) */
  importanceDecayRate: number;
  /** Minimum importance value after decay (default: 0.05) */
  importanceFloor: number;
  /** Rules that protect specific memories from decay */
  protectionRules: ProtectionRule[];
  /** Auto-consolidation settings */
  consolidation: ConsolidationConfig;
}

export const DEFAULT_DECAY_POLICY: DecayPolicyConfig = {
  halfLifeDays: 7,
  archiveThreshold: 0.05,
  decayIntervalMs: 60 * 60 * 1000, // 1 hour
  batchSize: 200,
  importanceDecayRate: 0.01,
  importanceFloor: 0.05,
  protectionRules: DEFAULT_PROTECTION_RULES,
  consolidation: DEFAULT_CONSOLIDATION,
};

/**
 * Merge a partial policy with the defaults.
 * Protection rules are replaced entirely if provided (not merged).
 */
export function mergePolicy(partial: Partial<DecayPolicyConfig>): DecayPolicyConfig {
  return {
    ...DEFAULT_DECAY_POLICY,
    ...partial,
    consolidation: {
      ...DEFAULT_CONSOLIDATION,
      ...partial.consolidation,
    },
    protectionRules: partial.protectionRules ?? DEFAULT_DECAY_POLICY.protectionRules,
  };
}
