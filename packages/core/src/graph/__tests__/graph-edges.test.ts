/**
 * Regression tests for KnowledgeGraph edge bookkeeping.
 *
 * - removeNode used findIndex+splice, removing only ONE incoming edge per
 *   source, so additional edges (a pair can legitimately have both relates_to
 *   and contradicts) survived as dangling references to a deleted node.
 * - removeEdge never removed the mirrored reverse edge created for
 *   bidirectional edges.
 */

import { describe, it, expect } from 'vitest';
import { KnowledgeGraph } from '../KnowledgeGraph.js';

function makeGraph(): KnowledgeGraph {
  const graph = new KnowledgeGraph();
  graph.addNode({ id: 'a', type: 'semantic' });
  graph.addNode({ id: 'b', type: 'semantic' });
  graph.addNode({ id: 'c', type: 'semantic' });
  return graph;
}

describe('KnowledgeGraph.removeNode', () => {
  it('removes every incoming edge from a source, not just the first', () => {
    const graph = makeGraph();
    // One source, two distinct relationships to the same target.
    graph.addEdge({ sourceId: 'a', targetId: 'b', relationship: 'relates_to', strength: 0.5, bidirectional: false });
    graph.addEdge({ sourceId: 'a', targetId: 'b', relationship: 'contradicts', strength: 0.9, bidirectional: false });
    expect(graph.edgeCount).toBe(2);

    graph.removeNode('b');

    expect(graph.edgeCount).toBe(0);
    expect(graph.expand(['a'], 1).some((n) => n.id === 'b')).toBe(false);
  });

  it('removes incoming edges from multiple sources', () => {
    const graph = makeGraph();
    graph.addEdge({ sourceId: 'a', targetId: 'c', relationship: 'relates_to', strength: 0.5, bidirectional: false });
    graph.addEdge({ sourceId: 'b', targetId: 'c', relationship: 'relates_to', strength: 0.5, bidirectional: false });

    graph.removeNode('c');

    expect(graph.edgeCount).toBe(0);
  });
});

describe('KnowledgeGraph.removeEdge', () => {
  it('removes the mirrored reverse edge of a bidirectional edge', () => {
    const graph = makeGraph();
    graph.addEdge({ sourceId: 'a', targetId: 'b', relationship: 'relates_to', strength: 0.5, bidirectional: true });
    // One connection, stored as a mirrored pair of adjacency entries — the
    // adjacency lists are what proves the mirror exists, since edgeCount now
    // reports connections rather than directions (see the suite below).
    expect(graph.edgeCount).toBe(1);
    expect(graph.getNeighbors('a')).toHaveLength(1);
    expect(graph.getNeighbors('b')).toHaveLength(1);

    graph.removeEdge('a', 'b', 'relates_to');

    expect(graph.edgeCount).toBe(0);
    expect(graph.getNeighbors('a')).toHaveLength(0);
    expect(graph.getNeighbors('b'), 'mirror survived removeEdge').toHaveLength(0);
    expect(graph.expand(['b'], 1).some((n) => n.id === 'a')).toBe(false);
  });

  it('leaves unrelated edges intact', () => {
    const graph = makeGraph();
    graph.addEdge({ sourceId: 'a', targetId: 'b', relationship: 'relates_to', strength: 0.5, bidirectional: false });
    graph.addEdge({ sourceId: 'a', targetId: 'c', relationship: 'relates_to', strength: 0.5, bidirectional: false });

    graph.removeEdge('a', 'b', 'relates_to');

    expect(graph.edgeCount).toBe(1);
    expect(graph.expand(['a'], 1).map((n) => n.id)).toContain('c');
  });
});

/**
 * `edgeCount` counts CONNECTIONS, not directions.
 *
 * It summed the adjacency lists, and `addEdge` stores a bidirectional link as
 * a mirrored pair, so every bidirectional connection was counted twice. The
 * number is `stats().graphEdges`, which the dashboard prints on the same
 * screen as `GET /api/graph/edges`'s own count of connection rows: a real
 * store reported 16,984 edges against 8,492 rows — two numbers for one noun,
 * differing by exactly the mirror.
 */
describe('KnowledgeGraph.edgeCount', () => {
  it('counts a bidirectional connection once, not once per direction', () => {
    const graph = makeGraph();
    graph.addEdge({ sourceId: 'a', targetId: 'b', relationship: 'relates_to', strength: 0.5, bidirectional: true });

    expect(graph.edgeCount).toBe(1);
    // The mirror is still there — traversal from either end must work.
    expect(graph.expand(['a'], 1).map((n) => n.id)).toEqual(['b']);
    expect(graph.expand(['b'], 1).map((n) => n.id)).toEqual(['a']);
  });

  it('counts a directed connection once', () => {
    const graph = makeGraph();
    graph.addEdge({ sourceId: 'a', targetId: 'b', relationship: 'relates_to', strength: 0.5, bidirectional: false });
    expect(graph.edgeCount).toBe(1);
  });

  it('counts opposite directed connections as two — they are two rows', () => {
    const graph = makeGraph();
    graph.addEdge({ sourceId: 'a', targetId: 'b', relationship: 'relates_to', strength: 0.5, bidirectional: false });
    graph.addEdge({ sourceId: 'b', targetId: 'a', relationship: 'relates_to', strength: 0.5, bidirectional: false });
    expect(graph.edgeCount).toBe(2);
  });

  it('separates relationships between the same pair', () => {
    const graph = makeGraph();
    graph.addEdge({ sourceId: 'a', targetId: 'b', relationship: 'relates_to', strength: 0.5, bidirectional: true });
    graph.addEdge({ sourceId: 'a', targetId: 'b', relationship: 'contradicts', strength: 0.9, bidirectional: true });
    expect(graph.edgeCount).toBe(2);
  });

  it('counts a bidirectional self-loop once', () => {
    // Its mirror lands in the same (target, relationship) slot and overwrites
    // it, so there is one adjacency entry — which is why folding the mirror
    // cannot be `entries - mirrors / 2`.
    const graph = makeGraph();
    graph.addEdge({ sourceId: 'a', targetId: 'a', relationship: 'relates_to', strength: 0.5, bidirectional: true });
    expect(graph.edgeCount).toBe(1);
  });

  it('is idempotent under replayed edges, as initialize() replays them', () => {
    const graph = makeGraph();
    const edge = { sourceId: 'a', targetId: 'b', relationship: 'relates_to' as const, strength: 0.5, bidirectional: true };
    graph.addEdge(edge);
    graph.addEdge(edge);
    graph.addEdge(edge);
    expect(graph.edgeCount).toBe(1);
  });

  it('is zero for an empty graph and after clear()', () => {
    const graph = makeGraph();
    expect(graph.edgeCount).toBe(0);
    graph.addEdge({ sourceId: 'a', targetId: 'b', relationship: 'relates_to', strength: 0.5, bidirectional: true });
    graph.clear();
    expect(graph.edgeCount).toBe(0);
  });
});
