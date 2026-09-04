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

/**
 * Identity of one connection, shared by both halves of a mirrored pair.
 *
 * The endpoints of a bidirectional edge are ordered so that the edge and its
 * mirror produce the same key; a directed edge keeps its own orientation,
 * because A→B and B→A are two different connections when neither is
 * bidirectional. NUL separates the parts so an id containing the separator
 * cannot forge a collision.
 */
function canonicalEdgeKey(edge: GraphEdge): string {
  const [first, second] =
    edge.bidirectional && edge.targetId < edge.sourceId
      ? [edge.targetId, edge.sourceId]
      : [edge.sourceId, edge.targetId];
  return `${first}\u0000${second}\u0000${edge.relationship}`;
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
    // Remove ALL edges pointing to this node. findIndex+splice removed only the
    // first match per source, so a pair connected by several relationships
    // (relates_to AND contradicts) kept dangling edges to a deleted node.
    for (const [sourceId, edges] of this.adjacency) {
      const remaining = edges.filter((e) => e.targetId !== id);
      if (remaining.length !== edges.length) this.adjacency.set(sourceId, remaining);
    }
  }

  addEdge(edge: GraphEdge): void {
    this.link(edge.sourceId, edge);

    if (edge.bidirectional) {
      this.link(edge.targetId, {
        ...edge,
        sourceId: edge.targetId,
        targetId: edge.sourceId,
      });
    }
  }

  /**
   * Attach one directed edge, replacing any edge that already occupies the same
   * (source, target, relationship) slot — the same slot the database's UNIQUE
   * constraint on memory_connections defines.
   *
   * Appending blindly made addEdge non-idempotent, and every caller replays
   * edges: initialize() re-adds every row (so a shutdown()/initialize() cycle
   * doubled the whole graph), and the reconcile fetches edges per id chunk (so
   * an edge whose two endpoints landed in different chunks was added twice).
   * Traversal results survived both — expand() keeps a visited set — but
   * stats().graphEdges and the cost of every traversal grew without bound.
   */
  private link(nodeId: string, edge: GraphEdge): void {
    const edges = this.adjacency.get(nodeId) ?? [];
    const existing = edges.findIndex(
      (e) => e.targetId === edge.targetId && e.relationship === edge.relationship
    );
    this.adjacency.set(
      nodeId,
      existing >= 0 ? edges.map((e, i) => (i === existing ? edge : e)) : [...edges, edge]
    );
  }

  removeEdge(sourceId: string, targetId: string, relationship: RelationshipType): void {
    const forward = this.adjacency.get(sourceId);
    if (forward) {
      this.adjacency.set(
        sourceId,
        forward.filter((e) => !(e.targetId === targetId && e.relationship === relationship))
      );
    }

    // addEdge stores a bidirectional edge as a mirrored pair, so the reverse
    // copy has to go too — otherwise it survived as a half-removed edge.
    const reverse = this.adjacency.get(targetId);
    if (reverse) {
      this.adjacency.set(
        targetId,
        reverse.filter(
          (e) => !(e.targetId === sourceId && e.relationship === relationship && e.bidirectional)
        )
      );
    }
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

  /**
   * How many CONNECTIONS the graph holds — one per link, not one per direction.
   *
   * `addEdge` stores a bidirectional link as a mirrored pair of directed
   * adjacency entries (see `link`), so summing the adjacency lists counted
   * every bidirectional connection twice. The number surfaced as
   * `stats().graphEdges`, which `engram stats` prints as its `Edges:` line
   * while `GET /api/graph/edges` reports its own `stored` count of connection
   * rows: on a real store those read 16,984 and 8,492 — two numbers for one
   * noun, differing by exactly the mirror.
   *
   * A connection is one edge regardless of which way it can be traversed, so
   * the mirror is folded away here. Directed links still count once each, and
   * a bidirectional self-loop occupies a single slot (its mirror overwrites
   * it), so it counts once too — which is why this is a set of canonical keys
   * rather than `entries - mirrors / 2`.
   */
  get edgeCount(): number {
    const seen = new Set<string>();
    for (const [, edges] of this.adjacency) {
      for (const edge of edges) seen.add(canonicalEdgeKey(edge));
    }
    return seen.size;
  }

  /** Clear the entire graph. */
  clear(): void {
    this.nodes.clear();
    this.adjacency.clear();
  }
}
