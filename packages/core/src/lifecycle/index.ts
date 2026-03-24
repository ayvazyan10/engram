export { DecayEngine } from './DecayEngine.js';
export type { DecaySweepResult } from './DecayEngine.js';

export { DEFAULT_DECAY_POLICY, DEFAULT_PROTECTION_RULES, mergePolicy } from './DecayPolicy.js';
export type { DecayPolicyConfig, ConsolidationConfig, ProtectionRule } from './DecayPolicy.js';

export { ContradictionDetector, DEFAULT_CONTRADICTION_CONFIG } from './ContradictionDetector.js';
export type {
  Contradiction,
  ContradictionSignal,
  ContradictionCheckResult,
  ContradictionConfig,
  ResolutionStrategy,
} from './ContradictionDetector.js';
