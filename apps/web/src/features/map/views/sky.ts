import type { MapNode } from '../../../lib/api.js';

export const DAY = 86_400_000;
export const SPREAD = 70;
export const DEPTH = 48;

/** Region mean age sets depth; younger members sit just in front of older ones. */
export function depthByAge(nodes: MapNode[], now: number): Float32Array {
  const ages = nodes.map((n) => Math.max(0, (now - Date.parse(n.createdAt)) / DAY));
  const members = new Map<string, number[]>();
  nodes.forEach((n, i) => members.set(n.regionId, [...(members.get(n.regionId) ?? []), i]));
  const means = [...members.values()].map((list) => list.reduce((sum, i) => sum + ages[i]!, 0) / list.length);
  const min = Math.min(...means), max = Math.max(...means);
  const positions = new Float32Array(nodes.length * 3);
  [...members.values()].forEach((list, r) => {
    const depth = DEPTH - 2 * DEPTH * (means[r]! - min) / (max - min || 1);
    [...list].sort((a, b) => ages[a]! - ages[b]!).forEach((i, rank) => {
      positions.set([nodes[i]!.x * SPREAD, nodes[i]!.y * SPREAD, depth + (0.5 - rank / Math.max(1, list.length - 1)) * 10], i * 3);
    });
  });
  return positions;
}

export function brightness(retention: number): number {
  return 0.16 + 0.84 * Math.min(1, Math.max(0, (Math.log10(Math.max(retention, 1e-6)) + 4) / 4));
}

/** Stable phases keep unrelated stars from twinkling in sync. */
export function phase(id: string): number {
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return (hash >>> 0) / 4294967296;
}
