/**
 * NeuralGraph — force-directed graph layout algorithm.
 *
 * Pure TypeScript implementation (no d3 dependency).
 * Runs in a Web Worker for smooth 60fps UI.
 */

export interface GraphNode {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural';
  label: string;
  activation: number; // 0.0–1.0
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  mass: number;
}

export interface GraphEdge {
  sourceId: string;
  targetId: string;
  strength: number;
}

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  z: number;
}

const REPULSION = 500;
const ATTRACTION = 0.1;
const DAMPING = 0.85;
const MIN_DIST = 5;
const SPACE = 200; // 3D space radius

export class NeuralGraph {
  private nodes = new Map<string, GraphNode>();
  private edges: GraphEdge[] = [];

  addNode(id: string, type: GraphNode['type'], label: string): void {
    if (this.nodes.has(id)) return;
    this.nodes.set(id, {
      id,
      type,
      label,
      activation: 0,
      x: (Math.random() - 0.5) * SPACE,
      y: (Math.random() - 0.5) * SPACE,
      z: (Math.random() - 0.5) * SPACE,
      vx: 0,
      vy: 0,
      vz: 0,
      mass: 1,
    });
  }

  removeNode(id: string): void {
    this.nodes.delete(id);
    this.edges = this.edges.filter((e) => e.sourceId !== id && e.targetId !== id);
  }

  addEdge(sourceId: string, targetId: string, strength: number = 1.0): void {
    this.edges.push({ sourceId, targetId, strength });
  }

  setActivation(id: string, activation: number): void {
    const node = this.nodes.get(id);
    if (node) node.activation = Math.max(0, Math.min(1, activation));
  }

  /**
   * Run N steps of force simulation.
   * Call this in a requestAnimationFrame loop or Web Worker tick.
   */
  tick(steps: number = 1): LayoutNode[] {
    for (let step = 0; step < steps; step++) {
      this.applyForces();
    }
    return this.getPositions();
  }

  private applyForces(): void {
    const nodeArray = [...this.nodes.values()];

    // Repulsion: push all nodes apart (O(n²) — use BVH for large graphs)
    for (let i = 0; i < nodeArray.length; i++) {
      for (let j = i + 1; j < nodeArray.length; j++) {
        const a = nodeArray[i]!;
        const b = nodeArray[j]!;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const dist = Math.max(MIN_DIST, Math.sqrt(dx * dx + dy * dy + dz * dz));
        const force = REPULSION / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const fz = (dz / dist) * force;

        a.vx -= fx / a.mass;
        a.vy -= fy / a.mass;
        a.vz -= fz / a.mass;
        b.vx += fx / b.mass;
        b.vy += fy / b.mass;
        b.vz += fz / b.mass;
      }
    }

    // Attraction: pull connected nodes together
    for (const edge of this.edges) {
      const a = this.nodes.get(edge.sourceId);
      const b = this.nodes.get(edge.targetId);
      if (!a || !b) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const dist = Math.max(MIN_DIST, Math.sqrt(dx * dx + dy * dy + dz * dz));
      const force = ATTRACTION * dist * edge.strength;

      a.vx += (dx / dist) * force;
      a.vy += (dy / dist) * force;
      a.vz += (dz / dist) * force;
      b.vx -= (dx / dist) * force;
      b.vy -= (dy / dist) * force;
      b.vz -= (dz / dist) * force;
    }

    // Update positions with damping + boundary
    for (const node of nodeArray) {
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.vz *= DAMPING;

      node.x = Math.max(-SPACE, Math.min(SPACE, node.x + node.vx));
      node.y = Math.max(-SPACE, Math.min(SPACE, node.y + node.vy));
      node.z = Math.max(-SPACE, Math.min(SPACE, node.z + node.vz));
    }
  }

  getPositions(): LayoutNode[] {
    return [...this.nodes.values()].map((n) => ({ id: n.id, x: n.x, y: n.y, z: n.z }));
  }

  getNodes(): GraphNode[] {
    return [...this.nodes.values()];
  }

  getEdges(): GraphEdge[] {
    return this.edges;
  }
}
