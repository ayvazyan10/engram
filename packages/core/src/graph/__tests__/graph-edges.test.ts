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
    expect(graph.edgeCount).toBe(2); // forward + mirror

    graph.removeEdge('a', 'b', 'relates_to');

    expect(graph.edgeCount).toBe(0);
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
