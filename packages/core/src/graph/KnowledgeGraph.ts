/**
 * KnowledgeGraph — in-memory graph for BFS/DFS traversal over memory connections.
 *
 * Loaded from the database on startup, kept in sync on mutations.
 * Used by ContextAssembler to expand retrieval beyond direct vector matches.
 */

import type { RelationshipType } from '../db/schema.js';

export interface GraphNode {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural';
  concept?: string | undefined;
}

export interface GraphEdge {
  sourceId: string;
  targetId: string;
  relationship: RelationshipType;
  strength: number;
  bidirectional: boolean;
}

export interface GraphNeighbor {
  id: string;
  relationship: RelationshipType;
  strength: number;
  depth: number;
}

export class KnowledgeGraph {
  // Adjacency list: nodeId → array of edges
  private adjacency = new Map<string, GraphEdge[]>();
  private nodes = new Map<string, GraphNode>();

  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
  }

  removeNode(id: string): void {
    this.nodes.delete(id);
    this.adjacency.delete(id);
    // Remove all edges pointing to this node
    for (const [, edges] of this.adjacency) {
      const idx = edges.findIndex((e) => e.targetId === id);
      if (idx >= 0) edges.splice(idx, 1);
    }
  }

  addEdge(edge: GraphEdge): void {
    if (!this.adjacency.has(edge.sourceId)) {
      this.adjacency.set(edge.sourceId, []);
    }
    this.adjacency.get(edge.sourceId)!.push(edge);

    if (edge.bidirectional) {
      if (!this.adjacency.has(edge.targetId)) {
        this.adjacency.set(edge.targetId, []);
      }
      this.adjacency.get(edge.targetId)!.push({
        ...edge,
        sourceId: edge.targetId,
        targetId: edge.sourceId,
      });
    }
  }

  removeEdge(sourceId: string, targetId: string, relationship: RelationshipType): void {
    const edges = this.adjacency.get(sourceId);
    if (!edges) return;
    const idx = edges.findIndex(
      (e) => e.targetId === targetId && e.relationship === relationship
    );
    if (idx >= 0) edges.splice(idx, 1);
  }

  /**
   * BFS traversal from a set of seed node IDs.
   * Returns all reachable neighbors within the given depth, sorted by strength.
   */
  expand(
    seedIds: string[],
    maxDepth: number = 2,
    relationshipTypes?: RelationshipType[]
  ): GraphNeighbor[] {
    const visited = new Set<string>(seedIds);
    const results: GraphNeighbor[] = [];
    const queue: Array<{ id: string; depth: number }> = seedIds.map((id) => ({
      id,
      depth: 0,
    }));

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item || item.depth >= maxDepth) continue;

      const edges = this.adjacency.get(item.id) ?? [];

      for (const edge of edges) {
        if (visited.has(edge.targetId)) continue;
        if (relationshipTypes && !relationshipTypes.includes(edge.relationship)) continue;

        visited.add(edge.targetId);
        results.push({
          id: edge.targetId,
          relationship: edge.relationship,
          strength: edge.strength,
          depth: item.depth + 1,
        });
        queue.push({ id: edge.targetId, depth: item.depth + 1 });
      }
    }

    // Sort by strength descending, then by depth ascending
    return results.sort((a, b) => b.strength - a.strength || a.depth - b.depth);
  }

  /** Get direct neighbors of a node. */
  getNeighbors(id: string): GraphEdge[] {
    return this.adjacency.get(id) ?? [];
  }

  /** Get a node by ID. */
  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    let total = 0;
    for (const [, edges] of this.adjacency) total += edges.length;
    return total;
  }

  /** Clear the entire graph. */
  clear(): void {
    this.nodes.clear();
    this.adjacency.clear();
  }
}
