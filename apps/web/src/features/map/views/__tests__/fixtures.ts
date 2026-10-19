import type { EdgeSummary, RecallExplanation, RecallItem } from '../../../../lib/api.js';
export { node, region, payload } from '../../__tests__/payload.js';
export function item(id: string, rank: number, overrides: Partial<RecallItem> = {}): RecallItem {
  return { id, rank, position: rank, offset: 0, chars: (overrides.tokens ?? 100) * 4, tokens: 100, section: 'knowledge', type: 'semantic', source: null, via: 'vector', similarity: 0.8, score: 0.7, included: true, ...overrides };
}
export function recall(overrides: Partial<RecallExplanation> = {}): RecallExplanation {
  return { context: 'Memory context', latencyMs: 12, budget: { maxTokens: 2000, usedTokens: 300 }, candidates: 4,
    items: [item('a', 1), item('d', 2, { via: 'graph', type: 'procedural' }), item('b', 3), item('e', 4, { included: false, position: null, tokens: 1800, via: 'graph', reason: 'over_budget' })], ...overrides };
}
export const graph: EdgeSummary = { total: 2, stored: 2, matching: 2, returned: 2, truncated: false, minStrength: 0, limit: 100,
  edges: [{ id: 'ad', sourceId: 'a', targetId: 'd', relationship: 'relates_to', strength: 1 }, { id: 'cd', sourceId: 'c', targetId: 'd', relationship: 'contradicts', strength: 1 }] };
