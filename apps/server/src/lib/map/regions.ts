import type { MapLink, Point } from './project.js';

interface Weighted { s: number; t: number; w: number }

// Deterministic weighted Louvain, ported from plates/AxesAndChords.tsx.
function louvain(size: number, edges: readonly Weighted[]): Int32Array {
  const membership = new Int32Array(size);
  for (let i = 0; i < size; i++) membership[i] = i;
  let count = size;
  let current: Weighted[] = edges.map((e) => ({ s: e.s, t: e.t, w: e.w }));

  for (let level = 0; level < 12; level++) {
    const adjacency: number[][] = Array.from({ length: count }, () => []);
    const strength = new Float64Array(count);
    let m2 = 0;
    for (const e of current) {
      if (e.s === e.t) {
        strength[e.s]! += e.w * 2;
        m2 += e.w * 2;
        continue;
      }
      adjacency[e.s]!.push(e.t, e.w);
      adjacency[e.t]!.push(e.s, e.w);
      strength[e.s]! += e.w;
      strength[e.t]! += e.w;
      m2 += 2 * e.w;
    }
    if (m2 === 0) break;

    const community = new Int32Array(count);
    for (let i = 0; i < count; i++) community[i] = i;
    const total = Float64Array.from(strength);
    let moved = false;

    for (let pass = 0; pass < 32; pass++) {
      let changed = false;
      for (let v = 0; v < count; v++) {
        const own = community[v]!;
        const near = new Map<number, number>();
        const list = adjacency[v]!;
        for (let k = 0; k < list.length; k += 2) {
          const c = community[list[k]!]!;
          near.set(c, (near.get(c) ?? 0) + list[k + 1]!);
        }
        total[own]! -= strength[v]!;
        let best = own;
        let bestGain = (near.get(own) ?? 0) - (total[own]! * strength[v]!) / m2;
        for (const [c, w] of near) {
          if (c === own) continue;
          const gain = w - (total[c]! * strength[v]!) / m2;
          if (gain > bestGain + 1e-12) {
            bestGain = gain;
            best = c;
          }
        }
        total[best]! += strength[v]!;
        if (best !== own) {
          community[v] = best;
          changed = true;
          moved = true;
        }
      }
      if (!changed) break;
    }

    const remap = new Map<number, number>();
    const renumbered = new Int32Array(count);
    for (let v = 0; v < count; v++) {
      const c = community[v]!;
      let id = remap.get(c);
      if (id === undefined) {
        id = remap.size;
        remap.set(c, id);
      }
      renumbered[v] = id;
    }
    for (let i = 0; i < size; i++) membership[i] = renumbered[membership[i]!]!;
    if (!moved || remap.size === count) break;

    const merged = new Map<string, number>();
    for (const e of current) {
      const a = renumbered[e.s]!;
      const b = renumbered[e.t]!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      merged.set(key, (merged.get(key) ?? 0) + e.w);
    }
    current = [];
    for (const [key, w] of merged) {
      const [a, b] = key.split(':');
      current.push({ s: Number(a), t: Number(b), w });
    }
    count = remap.size;
  }
  return membership;
}

/** Small communities join the nearest centroid. IDs use the squared-distance
 * medoid: the member nearest the centroid, computed in linear time. */
export function regionGroups(points: Point[], links: MapLink[]): { id: string; members: number[] }[] {
  const indices = new Map(points.map((p, i) => [p.id, i]));
  const membership = louvain(points.length, links.map((l) => ({
    s: indices.get(l.sourceId)!, t: indices.get(l.targetId)!, w: l.strength,
  })));
  const groups = new Map<number, { members: number[]; x: number; y: number }>();
  points.forEach((p, i) => {
    const id = membership[i]!;
    const group = groups.get(id) ?? { members: [], x: 0, y: 0 };
    group.members.push(i); group.x += p.x; group.y += p.y;
    groups.set(id, group);
  });
  for (const [id, group] of groups) {
    if (group.members.length >= 8 || groups.size === 1) continue;
    let best = -1, distance = Infinity;
    for (const [otherId, other] of groups) {
      if (id === otherId) continue;
      const d = (group.x / group.members.length - other.x / other.members.length) ** 2
        + (group.y / group.members.length - other.y / other.members.length) ** 2;
      if (d < distance) { best = otherId; distance = d; }
    }
    const target = groups.get(best)!;
    target.members.push(...group.members); target.x += group.x; target.y += group.y;
    groups.delete(id);
  }
  return [...groups.values()].map((group) => {
    const x = group.x / group.members.length, y = group.y / group.members.length;
    let medoid = group.members[0]!, distance = Infinity;
    for (const i of group.members) {
      const p = points[i]!;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < distance || (d === distance && p.id < points[medoid]!.id)) { medoid = i; distance = d; }
    }
    return { id: points[medoid]!.id, members: group.members.sort((a, b) => a - b) };
  });
}
