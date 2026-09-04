/**
 * DecayPolicy — configuration for memory decay and garbage collection.
 *
 * Controls how memories age, when they get archived, and when
 * auto-consolidation kicks in. Think of it as the brain's sleep
 * and forgetting parameters.
 */

import type { Memory } from '../db/schema.js';
import {
  assertNoUnknownKeys,
  assertNumberInRange,
  assertPlainObject,
} from './configValidation.js';
import type { NumericRange } from './configValidation.js';

/** Names this config in every validation message. */
const LABEL = 'decay policy';

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
  {
    name: 'ai-client-source',
    predicate: (m) => {
      const src = m.source ?? '';
      return src === 'claude-code' || src === 'ollama' || src === 'rest-api';
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
  /**
   * How far in the past a decay sweep measures to, and stamps `updated_at`
   * with. Defaults to {@link DEFAULT_DECAY_CONFLICT_WINDOW_MS} (1 hour).
   *
   * `updated_at` is two things at once: the clock last-write-wins compares
   * during sync, and this engine's decay checkpoint. Stamping it with
   * wall-clock `now` let a background bookkeeping write on a locally-stale row
   * beat a real content edit made on another device seconds earlier — the peer's
   * edit was overwritten and then pulled back as stale content. Holding the
   * stamp this far behind `now` means any content edit made inside the window
   * is strictly newer than anything a decay sweep can write, while decay stays
   * exactly linear: each sweep still applies precisely the interval between
   * consecutive stamps. Set it comfortably above your sync interval and any
   * clock skew between devices; 0 restores the old, unsafe behaviour.
   *
   * Optional so that a consumer who hand-writes a complete DecayPolicyConfig
   * does not get a compile error for a tuning knob they never asked to
   * configure. mergePolicy() fills it in, and DecayEngine falls back to the
   * same default for a policy constructed without going through mergePolicy —
   * so omitting it is always the safe 1-hour behaviour, never zero.
   */
  decayConflictWindowMs?: number;
  /** Rules that protect specific memories from decay */
  protectionRules: ProtectionRule[];
  /** Auto-consolidation settings */
  consolidation: ConsolidationConfig;
}

/** Fails to compile unless T is exactly `true`. */
type AssertTrue<T extends true> = T;

/**
 * Compile-time guard on a published-API promise: `decayConflictWindowMs` must
 * stay OPTIONAL. It is a tuning knob nobody asked for, and making it required
 * would break every consumer who hand-writes a complete DecayPolicyConfig
 * literal — a compile error for a field they have never heard of.
 *
 * Expressed as a type rather than a test because tsconfig excludes
 * `**\/*.test.ts`, so nothing in a test file is ever typechecked. If the field
 * is made required again, `Omit<...>` stops being assignable, this resolves to
 * `false`, and `pnpm typecheck` fails right here.
 */
type _WindowStaysOptional = AssertTrue<
  Omit<DecayPolicyConfig, 'decayConflictWindowMs'> extends DecayPolicyConfig ? true : false
>;

/**
 * Default conflict window: one hour. Named rather than inlined because both
 * mergePolicy() and DecayEngine have to land on the same value — a policy that
 * skipped mergePolicy must not silently decay with a zero-length window.
 */
export const DEFAULT_DECAY_CONFLICT_WINDOW_MS = 60 * 60 * 1000;

export const DEFAULT_DECAY_POLICY: DecayPolicyConfig = {
  halfLifeDays: 7,
  archiveThreshold: 0.05,
  decayIntervalMs: 60 * 60 * 1000, // 1 hour
  batchSize: 200,
  importanceDecayRate: 0.01,
  importanceFloor: 0.05,
  decayConflictWindowMs: DEFAULT_DECAY_CONFLICT_WINDOW_MS,
  protectionRules: DEFAULT_PROTECTION_RULES,
  consolidation: DEFAULT_CONSOLIDATION,
};

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Bounds every merged policy has to satisfy.
 *
 * These are not tuning advice — they exist because an out-of-range value does
 * not fail where it is set, it fails much later from inside a sweep, and the
 * failure looks like a bug in the engine:
 *
 *   - `batchSize` lands in the sweep's SQL LIMIT clause, and SQLite answers a
 *     fractional LIMIT with SQLITE_MISMATCH — a 500 on every sweep from then
 *     on, from a value the caller set successfully minutes earlier.
 *   - `decayIntervalMs` is handed to setInterval, which silently collapses
 *     anything above the signed 32-bit max to a 1ms delay: a "run yearly"
 *     typo becomes a hot loop.
 */
const POLICY_RANGES = {
  halfLifeDays: { min: 0, max: 36_500, exclusiveMin: true },
  archiveThreshold: { min: 0, max: 1 },
  decayIntervalMs: { min: 0, max: 2_147_483_647 },
  batchSize: { min: 1, max: 100_000, integer: true },
  importanceDecayRate: { min: 0, max: 1 },
  importanceFloor: { min: 0, max: 1 },
  // Capped at 30 days: a larger window would hold decay back further than any
  // plausible sync lag, which is a misconfiguration rather than a policy. The
  // field is optional on the interface but never optional here — mergePolicy
  // always fills it in before this runs, so a caller who DOES set it is still
  // bounds-checked.
  decayConflictWindowMs: { min: 0, max: 30 * 24 * 60 * 60 * 1000 },
} as const satisfies Record<string, NumericRange>;

const CONSOLIDATION_RANGES = {
  minClusterSize: { min: 2, max: 10_000, integer: true },
  similarityThreshold: { min: 0, max: 1 },
  minEpisodicAgeMs: { min: 0, max: Number.MAX_SAFE_INTEGER },
} as const satisfies Record<string, NumericRange>;

/** Every key mergePolicy knows how to copy. Anything else is a caller error. */
const POLICY_KEYS: readonly string[] = [
  ...Object.keys(POLICY_RANGES),
  'protectionRules',
  'consolidation',
];

/**
 * A protection rule is the one part of a policy that cannot survive
 * serialization: its `predicate` is a function, so anything parsed from JSON
 * arrives without one. DecayEngine.isProtected() calls that predicate for
 * every memory in every batch, so a rule that lacks it does not fail here —
 * it fails inside each sweep, indefinitely, with "rule.predicate is not a
 * function". Reject it where the policy is set instead.
 */
function assertProtectionRule(rule: unknown, index: number): void {
  const where = `protectionRules[${index}]`;
  if (typeof rule !== 'object' || rule === null) {
    throw new Error(`Invalid decay policy: ${where} must be an object`);
  }
  const { name, predicate } = rule as Partial<ProtectionRule>;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`Invalid decay policy: ${where}.name must be a non-empty string`);
  }
  if (typeof predicate !== 'function') {
    throw new Error(
      `Invalid decay policy: ${where} ('${name}') must have a callable predicate function ` +
        '— a policy parsed from JSON cannot express one'
    );
  }
}

function assertValidPolicy(policy: DecayPolicyConfig): void {
  for (const [field, range] of Object.entries(POLICY_RANGES)) {
    assertNumberInRange(LABEL, field, policy[field as keyof typeof POLICY_RANGES], range as NumericRange);
  }
  for (const [field, range] of Object.entries(CONSOLIDATION_RANGES)) {
    const value = policy.consolidation[field as keyof typeof CONSOLIDATION_RANGES];
    assertNumberInRange(LABEL, `consolidation.${field}`, value, range as NumericRange);
  }
  if (typeof policy.consolidation.enabled !== 'boolean') {
    throw new Error('Invalid decay policy: consolidation.enabled must be a boolean');
  }
  policy.protectionRules.forEach((rule, index) => assertProtectionRule(rule, index));
}

/**
 * Merge a partial policy with the defaults.
 * Protection rules are replaced entirely if provided (not merged).
 *
 * Fields are copied one by one rather than spread so that an unknown key, or
 * an explicit `undefined`, cannot reach the engine as policy — every caller
 * here (REST, MCP, CLI, embedders) hands over data it did not author.
 *
 * Throws on a policy that could not work, rather than accepting it and
 * failing later from inside a sweep. Callers keep the policy they had.
 */
export function mergePolicy(partial: Partial<DecayPolicyConfig>): DecayPolicyConfig {
  // The payload itself, before any field of it is read: a bare string spreads
  // into index keys, and an unknown key is a typo that would otherwise look
  // accepted. See lifecycle/configValidation.
  assertNoUnknownKeys(LABEL, assertPlainObject(LABEL, partial), POLICY_KEYS);

  // Checked before the copy below: spreading a non-iterable throws TypeError
  // ("is not iterable"), which tells the caller nothing about what to fix.
  if (partial.protectionRules !== undefined && !Array.isArray(partial.protectionRules)) {
    throw new Error('Invalid decay policy: protectionRules must be an array');
  }

  const merged: DecayPolicyConfig = {
    halfLifeDays: partial.halfLifeDays ?? DEFAULT_DECAY_POLICY.halfLifeDays,
    archiveThreshold: partial.archiveThreshold ?? DEFAULT_DECAY_POLICY.archiveThreshold,
    decayIntervalMs: partial.decayIntervalMs ?? DEFAULT_DECAY_POLICY.decayIntervalMs,
    batchSize: partial.batchSize ?? DEFAULT_DECAY_POLICY.batchSize,
    importanceDecayRate: partial.importanceDecayRate ?? DEFAULT_DECAY_POLICY.importanceDecayRate,
    importanceFloor: partial.importanceFloor ?? DEFAULT_DECAY_POLICY.importanceFloor,
    decayConflictWindowMs: partial.decayConflictWindowMs ?? DEFAULT_DECAY_CONFLICT_WINDOW_MS,
    consolidation: {
      enabled: partial.consolidation?.enabled ?? DEFAULT_CONSOLIDATION.enabled,
      minClusterSize: partial.consolidation?.minClusterSize ?? DEFAULT_CONSOLIDATION.minClusterSize,
      similarityThreshold:
        partial.consolidation?.similarityThreshold ?? DEFAULT_CONSOLIDATION.similarityThreshold,
      minEpisodicAgeMs:
        partial.consolidation?.minEpisodicAgeMs ?? DEFAULT_CONSOLIDATION.minEpisodicAgeMs,
    },
    // Copy the array: returning the module-level DEFAULT_PROTECTION_RULES by
    // reference meant every brain shared one mutable array with the exported
    // default, so a push/splice by any consumer altered the defaults globally.
    protectionRules: [...(partial.protectionRules ?? DEFAULT_DECAY_POLICY.protectionRules)],
  };

  assertValidPolicy(merged);
  return merged;
}
