import type { MapNode } from '../../../lib/api.js';
import type { DecayPolicy } from '../../memory/MemorySheet.js';

// Brain policy defaults, used only until the existing policy request resolves.
export const DEFAULT_POLICY: DecayPolicy = { halfLifeDays: 7, archiveThreshold: 0.05 };
export const GRID = 176;
export const EXTENT = 1.12;
export const WORLD = 5;
export const DECADE = 0.38;
export const FLOOR = -3;
const SIGMA = 0.07;
const CELL = 2 * EXTENT / (GRID - 1);

export function decayProjection(retention: number, day: number, halfLifeDays = 7): number {
  return retention * Math.pow(2, -Math.max(0, day) / halfLifeDays);
}

export function archiveDay(node: Pick<MapNode, 'retention' | 'protected'>, policy = DEFAULT_POLICY): number {
  return node.protected ? Infinity : Math.max(0, policy.halfLifeDays * Math.log2(node.retention / policy.archiveThreshold));
}

export function decades(value: number, threshold: number): number {
  return Math.max(FLOOR, Math.log10(Math.max(value, 1e-12) / threshold));
}

/** Today's Gaussian retention field, excluding memories archived by the chosen day.
 * Uniform projected decay is applied as a vertical shift, as in the prototype. */
export function heightField(nodes: MapNode[], day: number, policy = DEFAULT_POLICY): Float32Array {
  const field = new Float32Array(GRID * GRID);
  const radius = Math.ceil(4 * SIGMA / CELL);
  for (const node of nodes) {
    if (archiveDay(node, policy) <= day) continue;
    const cx = Math.round((node.x + EXTENT) / CELL), cy = Math.round((node.y + EXTENT) / CELL);
    for (let y = Math.max(0, cy - radius); y <= Math.min(GRID - 1, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(GRID - 1, cx + radius); x++) {
        const dx = x * CELL - EXTENT - node.x, dy = y * CELL - EXTENT - node.y;
        const i = y * GRID + x;
        field[i] = field[i]! + node.retention * Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
      }
    }
  }
  return field;
}

export function heightAt(field: Float32Array, x: number, y: number, threshold: number): number {
  const fx = Math.min(GRID - 1, Math.max(0, (x + EXTENT) / CELL));
  const fy = Math.min(GRID - 1, Math.max(0, (y + EXTENT) / CELL));
  const x0 = Math.min(GRID - 2, Math.floor(fx)), y0 = Math.min(GRID - 2, Math.floor(fy));
  const tx = fx - x0, ty = fy - y0;
  const f = (a: number, b: number) => field[b * GRID + a]!;
  return decades((f(x0, y0) * (1 - tx) + f(x0 + 1, y0) * tx) * (1 - ty) +
    (f(x0, y0 + 1) * (1 - tx) + f(x0 + 1, y0 + 1) * tx) * ty, threshold);
}
