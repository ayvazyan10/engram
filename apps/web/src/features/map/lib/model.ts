import type { Delaunay } from 'd3-delaunay';
import type { MapNode, MapPayload, MapRegion } from '../../../lib/api.js';
import { boundsOf, toLayout, type Rect } from './project.js';
import { terrain, type TerrainLevel } from './terrain.js';
import { buildIndex } from './hitTest.js';

/**
 * A payload made ready to draw, once per payload: layout positions in typed
 * arrays, the hit index, the terrain, and the regions biggest first. Nothing
 * here depends on the screen, so a resize or a zoom reuses all of it.
 */
export interface MapModel {
  nodes: MapNode[];
  at: Map<string, number>;
  xs: Float64Array;
  ys: Float64Array;
  /** createdAt as epoch ms, parsed once rather than per frame. */
  created: Float64Array;
  index: Delaunay<number>;
  terrain: TerrainLevel[];
  regions: MapRegion[];
  /** Where each region's label is anchored, in layout units. */
  anchors: Map<string, [number, number]>;
  bounds: Rect | null;
}

export function buildModel(payload: Pick<MapPayload, 'nodes' | 'regions'>): MapModel {
  const n = payload.nodes.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const created = new Float64Array(n);
  const at = new Map<string, number>();
  payload.nodes.forEach((node, i) => {
    [xs[i], ys[i]] = toLayout(node.x, node.y);
    created[i] = Date.parse(node.createdAt) || 0;
    at.set(node.id, i);
  });
  return {
    nodes: payload.nodes,
    at,
    xs,
    ys,
    created,
    index: buildIndex(xs, ys),
    terrain: terrain(xs, ys),
    regions: [...payload.regions].sort((a, b) => b.count - a.count),
    anchors: new Map(payload.regions.map((r) => [r.id, toLayout(r.x, r.y)])),
    bounds: boundsOf(xs, ys),
  };
}

/** The members of one region, as model indices. */
export function regionMembers(model: MapModel, regionId: string): number[] {
  const out: number[] = [];
  model.nodes.forEach((node, i) => {
    if (node.regionId === regionId) out.push(i);
  });
  return out;
}
