import type { Rect } from './project.js';

/** A region label to place: its anchor on screen and its measured size. */
export interface LabelBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a label may move off its anchor to clear another, nearest first. */
const NUDGES = [0, -30, 30, -56, 56];
const EDGE = 6;
/** Air kept between two names, so neighbouring regions do not read as one list. */
const GAP = 10;

/** Screen area each label needs to itself, so a small map shows fewer names. */
const AREA_PER_LABEL = 24_000;

/**
 * Places labels in the order given (the biggest regions first) without
 * overlap: each tries its anchor, then a few nudges up and down, and is
 * hidden (null) when none is free, its anchor is outside the area, or the
 * area has no room left for another name. A label is kept inside the area
 * sideways rather than cut at the edge.
 */
export function placeLabels(boxes: readonly LabelBox[], area: Rect): Map<string, { x: number; y: number } | null> {
  const budget = Math.max(1, Math.floor(((area.right - area.left) * (area.bottom - area.top)) / AREA_PER_LABEL));
  const placed: Rect[] = [];
  const out = new Map<string, { x: number; y: number } | null>();
  for (const box of boxes) {
    if (placed.length >= budget || box.x < area.left || box.x > area.right || box.y < area.top || box.y > area.bottom) {
      out.set(box.id, null);
      continue;
    }
    const x = Math.max(area.left + box.w / 2 + EDGE, Math.min(area.right - box.w / 2 - EDGE, box.x));
    let spot: { x: number; y: number } | null = null;
    for (const nudge of NUDGES) {
      const y = box.y + nudge;
      const r = { left: x - box.w / 2, right: x + box.w / 2, top: y - box.h / 2, bottom: y + box.h / 2 };
      if (r.top < area.top || r.bottom > area.bottom) continue;
      const clear = (q: Rect) => r.right + GAP < q.left || r.left - GAP > q.right || r.bottom + GAP < q.top || r.top - GAP > q.bottom;
      if (placed.every(clear)) {
        placed.push(r);
        spot = { x, y };
        break;
      }
    }
    out.set(box.id, spot);
  }
  return out;
}
