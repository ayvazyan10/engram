import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DemoModule, DemoProps, ObsData, ObsLink, ObsNode } from './contract';
import { RETENTION_LABEL } from './contract';

/**
 * SLOT 6 of 9 — hybrid. "Read the disagreement."
 *
 * ─── The argument ──────────────────────────────────────────────────────────
 *
 * Every other view of this store counts contradictions. A count is not a
 * finding: 1,539 is a number, and a number cannot be wrong. This slot spends
 * its whole box on the one thing none of the others do — putting the two
 * memories a `contradicts` edge joins side by side, with the detector's own
 * stated reason between them, so the disagreement can be READ and therefore
 * judged.
 *
 * Three independent agents reported the same striking fact: 459 renderable
 * pairs (549 store-wide) carry an agreement edge AND a contradiction edge at
 * once, and nothing reconciles them. Every one of them drew it as a symmetry —
 * a mirrored arc, a lens, a doubled cell. This slot asks the next question:
 * WHY, and the answer turns out to be visible in the drawn data, with no
 * appeal to the source.
 *
 * Bin every `relates_to` edge by the cosine similarity it recorded as its
 * strength, and mark in each bin how many of those pairs also carry a
 * contradiction. There is a cliff, and it is absolute:
 *
 *     agreements at cosine 0.65 and above   1,346, of which 459 contested
 *     agreements below cosine 0.65            216, of which   0 contested
 *
 * Not "few". None, of two hundred and sixteen. A step function that clean in
 * a smooth distribution is not a property of the memories; it is a THRESHOLD,
 * and it belongs to whatever raises a contradiction. So a `contradicts` edge
 * is not an opinion that happens to sit near an agreement — it is only ever
 * emitted about a pair the same embedding already called at least 0.65
 * similar. A contradiction edge IS a similarity claim, written under a second
 * name.
 *
 * That reframes the 459 completely. They are not the system asserting two
 * opposite things about one pair. They are ONE measurement — cosine
 * similarity — filed into two books by two writers who never compare notes,
 * and the reason the other ~70% of contradictions have no agreement beside
 * them is not disagreement either: the agreement writer keeps only a handful
 * of neighbours per memory, so most similar pairs never get an agreement row
 * at all. The store's books do not balance because nothing ever asked them
 * to.
 *
 * A second measurement makes the same point from the other side, and it is
 * why this slot reads text rather than drawing more geometry: 652 memories
 * carry 242 distinct labels. Sixty-three per cent of memories share their
 * 80-character label with another memory. You cannot tell a duplicate from a
 * disagreement at label resolution — which is exactly the condition under
 * which a contradiction detector goes quietly wrong, and exactly what a
 * reader has to be able to check.
 *
 * ─── What is on screen ─────────────────────────────────────────────────────
 *
 * THE RECONCILIATION (top). The denominators as a ledger, with the arithmetic
 * present rather than implied — stored, less the rows onto archived memories,
 * equals renderable — and one true-scale bar splitting the renderable pairs
 * into the three books. The contested band is drawn as a single mark carrying
 * both hues, because that is literally what those pairs are.
 *
 * THE DOCKET (left). Every renderable contradiction, one mark each, stacked
 * into columns. Two books:
 *   · by the detector's own confidence — the distribution nothing has drawn,
 *     piled at the bottom of its own scale;
 *   · by agreement strength — the cliff above, the whole argument in one
 *     shape.
 * In both books the foot of every column is the OTHER kind: the pairs that
 * carry both edges. Height is count, so density is geometry and nothing is
 * washed (rule 4). A mark's level within its hue is the token layer's
 * three-step ordinal ramp.
 *
 * THE READING (right). One pair, read. Both memories in full where the
 * detector's note carries their text, each with its type, retention band,
 * importance and link counts; between them a two-entry ledger of what the
 * store actually recorded — the contradiction's confidence and the
 * agreement's cosine — closed with a double rule over the one figure that
 * settles it: how many content words the two texts share.
 *
 * ─── One boundary decision, stated plainly ─────────────────────────────────
 *
 * `node.label` is 80 characters and 63% of memories share theirs. Two
 * identical 80-character strings side by side is not a readable disagreement,
 * so this plate additionally fetches `GET /api/contradictions?limit=1000` once
 * on mount — the endpoint that carries the detector's own note: the full text
 * of both memories, the signals it fired, and the resolution it suggests.
 *
 * This is the only demo that reaches past `data`, and it is a strict
 * enhancement: the overview never waits on it, and every pair is readable
 * without it. Where a note is missing the reading falls back to the label and
 * says so, with the real coverage figure on screen. The API caps that list at
 * 1,000, so roughly two contradictions in three carry a note; that
 * denominator is printed, not glossed. If the request fails the plate loses
 * the full text and the reasons, and nothing else.
 *
 * ─── Rules held ────────────────────────────────────────────────────────────
 *
 * 1  One file. Imports: the contract and React. Nothing installed.
 * 2  No module-level mutable state, and therefore no cache across mounts —
 *    the notes are refetched per mount rather than parked in a module object.
 * 3  No colour literal. Every fill and stroke is a `var(--…)`; this plate is
 *    SVG and DOM only, so it never needs the resolved values at all.
 * 4  Density is column height and mark count. No wash, no ramp, no alpha
 *    spent on density — a mark always sits at its full token colour.
 * 5  Retention is a WORD in the reading (`RETENTION_LABEL`), never a colour
 *    and never a hue-adjacent tint.
 * 6  Nothing ticks and nothing enters. `reducedMotion` additionally cuts the
 *    hover and selection transitions.
 * 7  Nothing that forces layout is transitioned. The only transitions are
 *    `opacity` and `color`, both paint-only, and the hover readout is
 *    positioned by `transform` rather than by `left`/`top`.
 * 8  Every subset states its real denominator from `data.stats`: stored
 *    against renderable in the reconciliation, note coverage against the
 *    contradiction count in the docket, and the filtered count against both.
 * 9  The box bleeds. No card, no radius, no shadow, no frame — the regions
 *    are separated by hairlines, which is what a ledger uses.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const nf = new Intl.NumberFormat('en-US');
const df = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** The detector's four signals, with the descriptions it publishes for them. */
const SIGNAL_ORDER = ['negation', 'value_change', 'opposite_sentiment', 'temporal_override'] as const;
type SignalName = (typeof SIGNAL_ORDER)[number];

const SIGNAL_NAME: Record<string, string> = {
  negation: 'negation',
  value_change: 'value change',
  opposite_sentiment: 'opposite sentiment',
  temporal_override: 'temporal override',
};

const SIGNAL_GLOSS: Record<string, string> = {
  negation: 'one text negates a statement the other makes',
  value_change: 'one text records a value or state changing',
  opposite_sentiment: 'the two express opposite sentiment about one subject',
  temporal_override: 'the newer text appears to update the older',
};

const STRATEGY_NAME: Record<string, string> = {
  keep_both: 'keep both',
  keep_newest: 'keep the newest',
  keep_oldest: 'keep the oldest',
  merge: 'merge them',
};

/** Layout. The plate splits into regions; these are the only fixed sizes. */
const PAD = 18;
const MAST_H = 92;
const AXIS_H = 42;
const CTRL_H = 30;
const FOOT_H = 92;
const CELL_MAX = 5;
const NARROW_AT = 960;
const SHORT_AT = 560;

// ─── Derivation ─────────────────────────────────────────────────────────────

/** One pair of memories, and whichever of the two edge kinds it carries. */
interface PairRow {
  key: string;
  /** Indices into `data.nodes`, ordered by id so the pair is stable. */
  a: number;
  b: number;
  agree: ObsLink | null;
  contra: ObsLink | null;
}

interface Ledger {
  rows: PairRow[];
  byKey: Map<string, PairRow>;
  contradicting: PairRow[];
  agreeing: PairRow[];
  contested: PairRow[];
  agreeOnly: number;
  contradictOnly: number;
  /** Every pair a memory takes part in, strongest claim first. The reading
   *  walks this, filtered to whichever book is open. */
  byMemory: Map<string, PairRow[]>;
  /** Memories party to at least one renderable contradiction. */
  memoriesWithContradiction: number;
  /** The cliff: the lowest agreement any contested pair sits on. */
  cliff: number;
  atOrAboveCliff: number;
  belowCliff: number;
  contestedAtOrAbove: number;
  contestedBelow: number;
  /** Distinct labels against memories — why the reading needs the full text. */
  distinctLabels: number;
  /** The most agreements any one memory is the SOURCE of. Flat at a small
   *  number here, which is what caps the agreement book: the auto-linker
   *  writes a fixed handful of neighbours per memory and never revisits. */
  maxOutAgrees: number;
}

function buildLedger(data: ObsData): Ledger {
  const byKey = new Map<string, PairRow>();
  for (const link of data.links) {
    const forward = link.sourceId < link.targetId;
    const key = forward ? `${link.sourceId}~${link.targetId}` : `${link.targetId}~${link.sourceId}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        key,
        a: forward ? link.source : link.target,
        b: forward ? link.target : link.source,
        agree: null,
        contra: null,
      };
      byKey.set(key, row);
    }
    // A pair holds at most one row per kind on this store; keep the strongest
    // if that ever stops being true rather than dropping one silently.
    if (link.kind === 'contradicts') {
      if (!row.contra || link.strength > row.contra.strength) row.contra = link;
    } else if (!row.agree || link.strength > row.agree.strength) {
      row.agree = link;
    }
  }

  const rows = [...byKey.values()];
  const contradicting = rows.filter((r) => r.contra !== null);
  const agreeing = rows.filter((r) => r.agree !== null);
  const contested = rows.filter((r) => r.agree !== null && r.contra !== null);

  const byMemory = new Map<string, PairRow[]>();
  const withContradiction = new Set<string>();
  for (const row of rows) {
    for (const index of [row.a, row.b]) {
      const id = data.nodes[index]!.id;
      const list = byMemory.get(id);
      if (list) list.push(row);
      else byMemory.set(id, [row]);
      if (row.contra) withContradiction.add(id);
    }
  }
  for (const list of byMemory.values()) {
    list.sort(
      (x, y) =>
        (y.contra?.strength ?? 0) - (x.contra?.strength ?? 0) ||
        (y.agree?.strength ?? 0) - (x.agree?.strength ?? 0)
    );
  }

  let cliff = Number.POSITIVE_INFINITY;
  for (const row of contested) cliff = Math.min(cliff, row.agree!.strength);
  if (!Number.isFinite(cliff)) cliff = 0;

  let atOrAboveCliff = 0;
  let belowCliff = 0;
  let contestedAtOrAbove = 0;
  let contestedBelow = 0;
  for (const row of agreeing) {
    const above = row.agree!.strength >= cliff;
    if (above) atOrAboveCliff++;
    else belowCliff++;
    if (row.contra) {
      if (above) contestedAtOrAbove++;
      else contestedBelow++;
    }
  }

  const labels = new Set<string>();
  for (const node of data.nodes) labels.add(node.label);

  const outAgrees = new Map<string, number>();
  let maxOutAgrees = 0;
  for (const link of data.links) {
    if (link.kind !== 'agrees') continue;
    const next = (outAgrees.get(link.sourceId) ?? 0) + 1;
    outAgrees.set(link.sourceId, next);
    if (next > maxOutAgrees) maxOutAgrees = next;
  }

  return {
    rows,
    byKey,
    contradicting,
    agreeing,
    contested,
    agreeOnly: agreeing.length - contested.length,
    contradictOnly: contradicting.length - contested.length,
    byMemory,
    memoriesWithContradiction: withContradiction.size,
    cliff,
    atOrAboveCliff,
    belowCliff,
    contestedAtOrAbove,
    contestedBelow,
    distinctLabels: labels.size,
    maxOutAgrees,
  };
}

// ─── The detector's notes ───────────────────────────────────────────────────

interface DetectorNote {
  signals: string[];
  strategy: string;
}

interface Notes {
  status: 'loading' | 'ready' | 'unavailable';
  byEdge: Map<string, DetectorNote>;
  text: Map<string, string>;
  returned: number;
  reason: string;
}

const NO_NOTES: Notes = {
  status: 'loading',
  byEdge: new Map(),
  text: new Map(),
  returned: 0,
  reason: '',
};

/** Narrow the response at the boundary — nothing here trusts its shape. */
function readNotes(payload: unknown): { byEdge: Map<string, DetectorNote>; text: Map<string, string> } {
  const byEdge = new Map<string, DetectorNote>();
  const text = new Map<string, string>();
  const list = (payload as { contradictions?: unknown })?.contradictions;
  if (!Array.isArray(list)) return { byEdge, text };
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as {
      edgeId?: unknown;
      metadata?: { signals?: unknown; suggestedStrategy?: unknown };
      source?: { id?: unknown; content?: unknown };
      target?: { id?: unknown; content?: unknown };
    };
    for (const side of [row.source, row.target]) {
      if (side && typeof side.id === 'string' && typeof side.content === 'string') {
        text.set(side.id, side.content);
      }
    }
    if (typeof row.edgeId !== 'string') continue;
    const rawSignals = row.metadata?.signals;
    byEdge.set(row.edgeId, {
      signals: Array.isArray(rawSignals) ? rawSignals.filter((s): s is string => typeof s === 'string') : [],
      strategy: typeof row.metadata?.suggestedStrategy === 'string' ? row.metadata.suggestedStrategy : '',
    });
  }
  return { byEdge, text };
}

function useDetectorNotes(): Notes {
  const [notes, setNotes] = useState<Notes>(NO_NOTES);
  useEffect(() => {
    const abort = new AbortController();
    let live = true;
    fetch('/api/contradictions?limit=1000', { signal: abort.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (!live) return;
        const { byEdge, text } = readNotes(payload);
        setNotes(
          byEdge.size > 0
            ? { status: 'ready', byEdge, text, returned: byEdge.size, reason: '' }
            : { ...NO_NOTES, status: 'unavailable', reason: 'the endpoint returned no notes' }
        );
      })
      .catch((cause: unknown) => {
        if (!live || abort.signal.aborted) return;
        setNotes({
          ...NO_NOTES,
          status: 'unavailable',
          reason: cause instanceof Error ? cause.message : String(cause),
        });
      });
    return () => {
      live = false;
      abort.abort();
    };
  }, []);
  return notes;
}

// ─── Books ──────────────────────────────────────────────────────────────────

type BookId = 'confidence' | 'agreement';

interface Cell {
  row: PairRow;
  /** The token ramp step this mark paints with. */
  step: 0 | 1 | 2;
  /** True when the mark stands for the pair's OTHER edge — the ledger's foot. */
  foot: boolean;
}

interface Column {
  index: number;
  lo: number;
  hi: number;
  cells: Cell[];
  foot: number;
}

interface Book {
  columns: Column[];
  lo: number;
  hi: number;
  max: number;
  total: number;
  footTotal: number;
}

function buildBook(rows: PairRow[], id: BookId, bins: number): Book {
  const value = (row: PairRow) => (id === 'confidence' ? row.contra!.strength : row.agree!.strength);
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const v = value(row);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    return { columns: [], lo: 0, hi: 1, max: 0, total: 0, footTotal: 0 };
  }

  const columns: Column[] = Array.from({ length: bins }, (_, index) => ({
    index,
    lo: lo + ((hi - lo) * index) / bins,
    hi: lo + ((hi - lo) * (index + 1)) / bins,
    cells: [],
    foot: 0,
  }));

  let footTotal = 0;
  for (const row of rows) {
    const v = value(row);
    const index = Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bins)));
    const contested = row.agree !== null && row.contra !== null;
    // The mark takes the hue of the book it is filed in; the foot takes the
    // other kind's hue and its own strength step, so the double entry is the
    // same fact seen from both books.
    const own = id === 'confidence' ? row.contra! : row.agree!;
    const other = id === 'confidence' ? row.agree : row.contra;
    const column = columns[index]!;
    column.cells.push({
      row,
      step: contested && other ? other.step : own.step,
      foot: contested,
    });
    if (contested) {
      column.foot++;
      footTotal++;
    }
  }

  let max = 0;
  for (const column of columns) {
    // Feet at the base, so the contested band is one continuous edge along the
    // axis and reads as a second column inside the column.
    column.cells.sort((x, y) => Number(y.foot) - Number(x.foot) || x.row.key.localeCompare(y.row.key));
    if (column.cells.length > max) max = column.cells.length;
  }
  return { columns, lo, hi, max, total: rows.length, footTotal };
}

// ─── Text ───────────────────────────────────────────────────────────────────

/** Content words: four letters or more, lowercased, deduplicated. */
function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length >= 4) out.add(word);
  }
  return out;
}

function overlapOf(left: string, right: string): { shared: number; union: number; ratio: number } {
  const a = contentWords(left);
  const b = contentWords(right);
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  const union = a.size + b.size - shared;
  return { shared, union, ratio: union > 0 ? shared / union : 0 };
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const CSS = `
.dl { position:absolute; inset:0; display:grid; min-width:0; min-height:0;
      background:var(--plate); overflow:hidden; }

.dl-mast { grid-column:1 / -1; display:flex; align-items:flex-end; gap:var(--gap-section);
           padding:12px ${PAD}px 10px; border-bottom:1px solid var(--rule);
           min-width:0; overflow:hidden; }
.dl-mast.dl-tight { gap:var(--gap-block); }
.dl-mast.dl-tight .dl-recon-note { display:none; }
.dl-mast.dl-tight .dl-recon-cell { padding:0 9px; }
.dl-recon { display:flex; align-items:flex-end; gap:0; flex:0 0 auto; }
.dl-recon-cell { padding:0 13px; border-left:1px solid var(--rule); }
.dl-recon-cell:first-child { padding-left:0; border-left:none; }
.dl-op { align-self:center; color:var(--ink-3); font-size:var(--t-figure);
         padding:0 2px 2px; font-variant-numeric:tabular-nums; }
.dl-recon-value { display:block; font-size:var(--t-figure); line-height:1.25; margin-top:1px; }
.dl-recon-note { font-size:var(--t-label); color:var(--ink-3); line-height:1.3; }

.dl-books { flex:1 1 auto; min-width:0; display:flex; flex-direction:column;
            gap:5px; padding-bottom:2px; }
.dl-books-key { display:flex; gap:16px; flex-wrap:wrap; align-items:baseline; }
.dl-key { display:flex; align-items:center; gap:6px; font-size:var(--t-label); color:var(--ink-3); }
.dl-key b { font-weight:600; color:var(--ink-2); font-variant-numeric:tabular-nums; }

.dl-docket { display:flex; flex-direction:column; min-width:0; min-height:0;
             border-right:1px solid var(--rule); }
.dl-ctrl { display:flex; align-items:center; gap:14px; padding:0 ${PAD}px; flex:0 0 auto;
           height:${CTRL_H}px; margin:0; overflow:hidden;
           border-bottom:1px solid var(--rule); }
.dl-ctrl-inner { display:flex; gap:1px; background:var(--rule); align-self:stretch;
                 margin:4px 0; }
.dl-tab { padding:4px 11px; background:var(--plate); color:var(--ink-3);
          font-size:var(--t-label); font-stretch:78%; font-weight:500;
          transition:color var(--dur) var(--ease); }
.dl-tab:hover { color:var(--ink-2); }
.dl-tab[aria-pressed='true'] { color:var(--ink); background:var(--rule); }
/* The key lives in the control row: two swatches name the body and the foot
   of a column, so the chart never needs a legend block of its own. */
.dl-ctrl-key { margin-left:auto; display:flex; align-items:center; gap:13px;
               font-size:var(--t-label); color:var(--ink-3); white-space:nowrap; }
.dl-ctrl-key span { display:flex; align-items:center; gap:5px; }
.dl-ctrl-key i { font-style:normal; font-variant-numeric:tabular-nums; }

.dl-plot { position:relative; flex:1 1 auto; min-height:0; padding:0 ${PAD}px; overflow:hidden; }
.dl-cell { cursor:pointer; }
.dl-cell.dl-open { stroke:var(--ink); stroke-width:1; }
.dl-foot-line { pointer-events:none; }

/* Mark fills as classes rather than presentation attributes: the token layer
   is the only source, and a class cannot be mistaken for an inline colour. */
.dl-m-a0 { fill:var(--agrees-weak); }
.dl-m-a1 { fill:var(--agrees-mid); }
.dl-m-a2 { fill:var(--agrees-strong); }
.dl-m-c0 { fill:var(--contradicts-weak); }
.dl-m-c1 { fill:var(--contradicts-mid); }
.dl-m-c2 { fill:var(--contradicts-strong); }
.dl-axis-text { font-size:var(--t-label); font-stretch:78%; font-weight:500; fill:var(--ink-3); }
.dl-cliff-text { font-size:var(--t-label); font-stretch:78%; font-weight:500; fill:var(--ink-2); }

.dl-chips { display:flex; flex-wrap:wrap; gap:6px; padding:2px ${PAD}px 0; flex:0 0 auto; }
.dl-chip { display:flex; align-items:center; gap:5px; padding:2px 8px 3px;
           border:1px solid var(--rule); color:var(--ink-3);
           font-size:var(--t-label); font-stretch:78%; font-weight:500;
           transition:color var(--dur) var(--ease), opacity var(--dur) var(--ease); }
.dl-chip:hover { color:var(--ink-2); }
.dl-chip[aria-pressed='true'] { color:var(--ink); background:var(--rule); }
.dl-chip i { font-style:normal; font-variant-numeric:tabular-nums; opacity:0.75; }

.dl-docket-foot { padding:10px ${PAD}px 12px; min-height:0; flex:0 1 auto; overflow:hidden; }
.dl-docket-foot .obs-note { max-width:none; margin:0; }

.dl-readout { position:absolute; top:0; left:0; pointer-events:none; z-index:2;
              max-width:270px; padding:7px 9px 8px; background:var(--margin);
              border:1px solid var(--rule); }
.dl-readout p { margin:0; font-size:var(--t-label); color:var(--ink-2);
                line-height:1.35; overflow-wrap:anywhere; }
.dl-readout .dl-readout-fig { color:var(--ink); font-variant-numeric:tabular-nums;
                              margin-top:3px; }

.dl-read { display:flex; flex-direction:column; min-width:0; min-height:0; overflow:hidden; }
.dl-read-head { display:flex; align-items:center; gap:12px; padding:0 ${PAD}px;
                height:${CTRL_H}px; border-bottom:1px solid var(--rule); }
.dl-read-head .dl-where { font-size:var(--t-label); color:var(--ink-3);
                          font-variant-numeric:tabular-nums; }
.dl-step { padding:1px 8px 2px; border:1px solid var(--rule); color:var(--ink-3);
           font-size:var(--t-label); transition:color var(--dur) var(--ease); }
.dl-step:hover:enabled { color:var(--ink); }
.dl-step:disabled { opacity:0.35; cursor:default; }

.dl-panes { flex:1 1 auto; min-height:0; display:grid; gap:0; }
.dl-pane { min-width:0; min-height:0; display:flex; flex-direction:column;
           padding:12px ${PAD}px 0; border-left:1px solid var(--rule); }
.dl-pane:first-child { border-left:none; }
/* Stacked, the divider between the two memories runs across, not down. */
.dl-panes.dl-stacked .dl-pane { border-left:none; border-top:1px solid var(--rule); }
.dl-panes.dl-stacked .dl-pane:first-child { border-top:none; }
.dl-pane-head { text-align:left; width:100%; }
.dl-pane-label { font-size:var(--t-figure); font-weight:600; line-height:var(--lead-tight);
                 color:var(--ink); letter-spacing:-0.005em; overflow-wrap:anywhere;
                 transition:opacity var(--dur) var(--ease); }
.dl-pane-head:hover .dl-pane-label { opacity:0.72; }
.dl-pane-head[aria-pressed='true'] .dl-pane-label { text-decoration:underline;
                 text-underline-offset:3px; text-decoration-thickness:1px; }
/* A memory's fields as a record, not as a dot-separated string: the field
   name in the narrow cut, the value against it, aligned down the pane. */
.dl-meta { display:grid; grid-template-columns:max-content 1fr; column-gap:12px;
           row-gap:1px; margin-top:7px; align-items:baseline; }
.dl-meta dt { font-size:var(--t-label); font-stretch:78%; font-weight:500;
              color:var(--ink-3); letter-spacing:0.01em; }
.dl-meta dd { margin:0; font-size:var(--t-label); color:var(--ink-2);
              font-variant-numeric:tabular-nums; }
.dl-text { flex:1 1 auto; min-height:0; overflow:auto; margin-top:9px;
           padding:9px 0 14px; border-top:1px solid var(--rule);
           font-family:var(--font-note); font-weight:300; font-size:var(--t-claim);
           line-height:1.45; color:var(--ink-2); white-space:pre-wrap;
           overflow-wrap:anywhere; max-width:52ch; }
.dl-text-missing { font-family:var(--font-instrument); font-size:var(--t-label);
                   color:var(--ink-3); white-space:normal; }

.dl-verdict { border-top:1px solid var(--rule); padding:10px ${PAD}px 12px; }
.dl-entry { display:flex; align-items:baseline; gap:10px; padding:2px 0;
            font-size:var(--t-body); }
.dl-entry .dl-swatch { width:3px; height:12px; flex:0 0 auto; align-self:center; }
.dl-entry .dl-entry-name { color:var(--ink-2); min-width:12ch; }
.dl-entry .dl-entry-fig { font-variant-numeric:tabular-nums; color:var(--ink);
                          font-weight:500; min-width:9ch; text-align:right; }
.dl-entry .dl-entry-note { color:var(--ink-3); font-size:var(--t-label); }
.dl-entry-absent .dl-entry-name, .dl-entry-absent .dl-entry-fig { color:var(--ink-3); font-weight:400; }
.dl-double { height:3px; margin:6px 0 5px; border-top:1px solid var(--rule);
             border-bottom:1px solid var(--rule); }
.dl-total { display:flex; align-items:baseline; gap:10px; }
.dl-total .dl-entry-name { color:var(--ink-2); min-width:12ch; font-size:var(--t-body); }
.dl-total .dl-entry-fig { font-size:var(--t-stat); font-weight:600; line-height:var(--lead-tight); }
.dl-reasons { margin-top:7px; font-size:var(--t-label); color:var(--ink-3); line-height:1.45; }
.dl-reasons b { font-weight:500; color:var(--ink-2); }

.dl-empty { padding:26px ${PAD}px; }
.dl-empty .obs-note { margin:0 0 10px; max-width:46ch; }
.dl-empty p.dl-empty-sub { margin:0; font-size:var(--t-label); color:var(--ink-3);
                           max-width:60ch; line-height:1.5; }
.dl-still, .dl-still * { transition:none !important; }
`;

// ─── Reconciliation ─────────────────────────────────────────────────────────

function Reconciliation({
  data,
  ledger,
  width,
  tight,
}: {
  data: ObsData;
  ledger: Ledger;
  width: number;
  tight: boolean;
}) {
  const { stats } = data;
  const pairs = ledger.rows.length;
  const barWidth = Math.max(110, width - 2 * PAD - (tight ? 330 : 430));
  const scale = (n: number) => (pairs > 0 ? (n / pairs) * (barWidth - 4) : 0);
  const wAgree = scale(ledger.agreeOnly);
  const wBoth = scale(ledger.contested.length);
  const wContra = scale(ledger.contradictOnly);

  return (
    <header className={`dl-mast${tight ? ' dl-tight' : ''}`}>
      <div className="dl-recon">
        <div className="dl-recon-cell">
          <div className="obs-label">Links stored</div>
          <span className="obs-figure dl-recon-value">{nf.format(stats.linksStored)}</span>
          <div className="dl-recon-note">every connection row</div>
        </div>
        <span className="dl-op" aria-hidden>
          &minus;
        </span>
        <div className="dl-recon-cell">
          <div className="obs-label">Not renderable</div>
          <span className="obs-figure dl-recon-value">{nf.format(stats.linksToArchived)}</span>
          <div className="dl-recon-note">onto archived memories</div>
        </div>
        <span className="dl-op" aria-hidden>
          =
        </span>
        <div className="dl-recon-cell">
          <div className="obs-label">Renderable</div>
          <span className="obs-figure dl-recon-value">{nf.format(stats.linksDrawn)}</span>
          <div className="dl-recon-note">over {nf.format(pairs)} pairs</div>
        </div>
      </div>

      <div className="dl-books">
        <svg width={barWidth} height={11} role="img" aria-label="The three books, at true scale">
          <rect x={0} y={0} width={wAgree} height={11} fill="var(--agrees-mid)" />
          {/* The contested band carries both hues because that is what it is. */}
          <rect x={wAgree + 2} y={0} width={wBoth} height={5} fill="var(--contradicts-mid)" />
          <rect x={wAgree + 2} y={6} width={wBoth} height={5} fill="var(--agrees-mid)" />
          <rect x={wAgree + wBoth + 4} y={0} width={wContra} height={11} fill="var(--contradicts-mid)" />
        </svg>
        <div className="dl-books-key">
          <span className="dl-key">
            <span className="obs-swatch" style={{ background: 'var(--agrees-mid)' }} aria-hidden />
            agrees only <b>{nf.format(ledger.agreeOnly)}</b>
          </span>
          <span className="dl-key">
            <span
              className="obs-swatch"
              style={{
                background: 'var(--agrees-mid)',
                borderTop: '5px solid var(--contradicts-mid)',
              }}
              aria-hidden
            />
            both, contested <b>{nf.format(ledger.contested.length)}</b>
          </span>
          <span className="dl-key">
            <span className="obs-swatch" style={{ background: 'var(--contradicts-mid)' }} aria-hidden />
            contradicts only <b>{nf.format(ledger.contradictOnly)}</b>
          </span>
        </div>
      </div>
    </header>
  );
}

// ─── The docket ─────────────────────────────────────────────────────────────

interface HoverState {
  x: number;
  y: number;
  row: PairRow;
}

function Docket({
  data,
  ledger,
  notes,
  book,
  onBook,
  filter,
  onFilter,
  width,
  height,
  openKey,
  onOpen,
  reducedMotion,
}: {
  data: ObsData;
  ledger: Ledger;
  notes: Notes;
  book: BookId;
  onBook: (id: BookId) => void;
  filter: SignalName | null;
  onFilter: (name: SignalName | null) => void;
  width: number;
  height: number;
  openKey: string | null;
  onOpen: (row: PairRow) => void;
  reducedMotion: boolean;
}) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);

  const plotW = Math.max(80, width - 2 * PAD);
  const plotH = Math.max(40, height - CTRL_H - AXIS_H - FOOT_H - (book === 'confidence' ? 26 : 0));

  const signalCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of ledger.contradicting) {
      const note = row.contra ? notes.byEdge.get(row.contra.id) : undefined;
      if (!note) continue;
      for (const signal of note.signals) counts.set(signal, (counts.get(signal) ?? 0) + 1);
    }
    return counts;
  }, [ledger.contradicting, notes.byEdge]);

  const source = useMemo(() => {
    const base = book === 'confidence' ? ledger.contradicting : ledger.agreeing;
    if (book !== 'confidence' || !filter) return base;
    return base.filter((row) => {
      const note = row.contra ? notes.byEdge.get(row.contra.id) : undefined;
      return note ? note.signals.includes(filter) : false;
    });
  }, [book, filter, ledger.agreeing, ledger.contradicting, notes.byEdge]);

  const bins = Math.max(10, Math.min(30, Math.round(plotW / 22)));
  const built = useMemo(() => buildBook(source, book, bins), [source, book, bins]);

  const cellH = built.max > 0 ? Math.min(CELL_MAX, plotH / built.max) : CELL_MAX;
  const gap = cellH >= 3 ? 1 : 0;
  const colW = built.columns.length > 0 ? plotW / built.columns.length : plotW;
  const markW = Math.max(1, colW - 2);
  const hue = book === 'confidence' ? 'c' : 'a';
  const footHue = book === 'confidence' ? 'a' : 'c';
  const bodyToken = book === 'confidence' ? 'contradicts' : 'agrees';
  const footToken = book === 'confidence' ? 'agrees' : 'contradicts';

  const openRow = openKey ? ledger.byKey.get(openKey) ?? null : null;

  const onCell = useCallback(
    (event: React.MouseEvent, row: PairRow) => {
      const box = plotRef.current?.getBoundingClientRect();
      if (!box) return;
      setHover({ x: event.clientX - box.left, y: event.clientY - box.top, row });
    },
    []
  );

  const axisTicks = useMemo(() => {
    if (built.columns.length === 0) return [];
    const out: { at: number; value: number }[] = [];
    for (let i = 0; i <= 4; i++) out.push({ at: i / 4, value: built.lo + ((built.hi - built.lo) * i) / 4 });
    return out;
  }, [built.columns.length, built.hi, built.lo]);

  const cliffAt =
    book === 'agreement' && built.hi > built.lo
      ? (ledger.cliff - built.lo) / (built.hi - built.lo)
      : null;

  const readoutW = 270;
  const hoverText = hover
    ? {
        a: data.nodes[hover.row.a]!,
        b: data.nodes[hover.row.b]!,
      }
    : null;

  return (
    <section className="dl-docket" aria-label="Every renderable contradiction">
      <div className="dl-ctrl">
        <div className="dl-ctrl-inner" role="group" aria-label="Which book">
          <button
            type="button"
            className={`dl-tab${reducedMotion ? ' dl-still' : ''}`}
            aria-pressed={book === 'confidence'}
            onClick={() => onBook('confidence')}
          >
            by the detector&rsquo;s confidence
          </button>
          <button
            type="button"
            className={`dl-tab${reducedMotion ? ' dl-still' : ''}`}
            aria-pressed={book === 'agreement'}
            onClick={() => onBook('agreement')}
          >
            by agreement strength
          </button>
        </div>
        <span className="dl-ctrl-key">
          <span>
            <span className="obs-swatch" style={{ background: `var(--${bodyToken}-mid)` }} aria-hidden />
            {book === 'confidence' ? 'a contradiction' : 'an agreement'}
          </span>
          <span>
            <span className="obs-swatch" style={{ background: `var(--${footToken}-mid)` }} aria-hidden />
            {book === 'confidence' ? 'and also an agreement' : 'and also a contradiction'}
          </span>
          <i>tallest column {nf.format(built.max)}</i>
        </span>
      </div>

      <div className="dl-plot" ref={plotRef} onMouseLeave={() => setHover(null)}>
        <svg
          width={plotW}
          height={plotH + AXIS_H}
          role="img"
          aria-label={
            book === 'confidence'
              ? `Every renderable contradiction, stacked by the confidence the detector gave it. ${nf.format(built.footTotal)} of ${nf.format(built.total)} also carry an agreement edge.`
              : `Every renderable agreement, stacked by the cosine similarity recorded as its strength. ${nf.format(built.footTotal)} of ${nf.format(built.total)} also carry a contradiction, none of them below ${ledger.cliff.toFixed(2)}.`
          }
        >
          {built.columns.map((column) => {
            const x = column.index * colW + (colW - markW) / 2;
            const isOpenColumn =
              openRow !== null && column.cells.some((cell) => cell.row.key === openRow.key);
            return (
              <g key={column.index}>
                {column.cells.map((cell, i) => {
                  const y = plotH - (i + 1) * cellH;
                  const isOpen = openRow !== null && cell.row.key === openRow.key;
                  return (
                    <rect
                      key={cell.row.key}
                      className={`dl-cell dl-m-${cell.foot ? footHue : hue}${cell.step}${isOpen ? ' dl-open' : ''}`}
                      x={x}
                      y={y}
                      width={markW}
                      height={Math.max(1, cellH - gap)}
                      onMouseMove={(event) => onCell(event, cell.row)}
                      onClick={() => onOpen(cell.row)}
                    />
                  );
                })}
                {/* The foot's upper edge, so the contested band has one line. */}
                {column.foot > 0 ? (
                  <rect
                    className="dl-foot-line"
                    x={x}
                    y={plotH - column.foot * cellH - 1}
                    width={markW}
                    height={1}
                    fill="var(--ink-3)"
                  />
                ) : null}
                {isOpenColumn ? (
                  <rect
                    className="dl-foot-line"
                    x={x}
                    y={plotH + 1}
                    width={markW}
                    height={2}
                    fill="var(--ink)"
                  />
                ) : null}
              </g>
            );
          })}

          <line x1={0} y1={plotH + 0.5} x2={plotW} y2={plotH + 0.5} stroke="var(--rule)" strokeWidth={1} />

          {cliffAt !== null ? (
            <g>
              <line
                x1={cliffAt * plotW}
                y1={0}
                x2={cliffAt * plotW}
                y2={plotH}
                stroke="var(--ink-3)"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              <text className="dl-cliff-text" x={cliffAt * plotW + 5} y={11}>
                nothing contested below {ledger.cliff.toFixed(2)}
              </text>
            </g>
          ) : null}

          {axisTicks.map((tick) => (
            <text
              key={tick.at}
              className="dl-axis-text"
              x={Math.min(plotW - 1, Math.max(0, tick.at * plotW))}
              y={plotH + 15}
              textAnchor={tick.at === 0 ? 'start' : tick.at === 1 ? 'end' : 'middle'}
            >
              {tick.value.toFixed(2)}
            </text>
          ))}

          <text className="dl-axis-text" x={plotW / 2} y={plotH + 31} textAnchor="middle">
            {book === 'confidence'
              ? 'the confidence the detector recorded — every mark one pair, stacked'
              : 'the cosine similarity the auto-linker recorded — every mark one pair, stacked'}
          </text>
        </svg>

        {hover && hoverText ? (
          <div
            className="dl-readout"
            style={{
              transform: `translate(${Math.max(0, Math.min(plotW - readoutW, hover.x + 12))}px, ${Math.max(0, hover.y - 62)}px)`,
              width: readoutW,
            }}
          >
            <p>{hoverText.a.label}</p>
            <p>{hoverText.b.label}</p>
            <p className="dl-readout-fig">
              contradicts {hover.row.contra ? hover.row.contra.strength.toFixed(3) : '—'}
              {hover.row.agree ? ` · agrees ${hover.row.agree.strength.toFixed(2)}` : ' · no agreement'}
            </p>
          </div>
        ) : null}
      </div>

      {book === 'confidence' ? (
        <div className="dl-chips" role="group" aria-label="Filter by the reason the detector gave">
          {SIGNAL_ORDER.map((signal) => {
            const count = signalCounts.get(signal) ?? 0;
            return (
              <button
                key={signal}
                type="button"
                className={`dl-chip${reducedMotion ? ' dl-still' : ''}`}
                aria-pressed={filter === signal}
                disabled={count === 0}
                style={count === 0 ? { opacity: 0.4 } : undefined}
                onClick={() => onFilter(filter === signal ? null : signal)}
              >
                {SIGNAL_NAME[signal]} <i>{nf.format(count)}</i>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="dl-docket-foot">
        {book === 'agreement' ? (
          <p className="obs-note">
            {nf.format(ledger.contestedAtOrAbove)} of the {nf.format(ledger.atOrAboveCliff)} agreements
            at cosine {ledger.cliff.toFixed(2)} or above also carry a contradiction. Below it, none of{' '}
            {nf.format(ledger.belowCliff)}. Nothing raises a contradiction about a pair the embedding
            has not already called similar — so a contradiction edge is a similarity claim under a
            second name, and the {nf.format(ledger.contested.length)} contested pairs are one
            measurement filed into two books.
          </p>
        ) : (
          <p className="obs-note">
            Every one of {nf.format(ledger.contradicting.length)} renderable contradictions is a mark
            here; {nf.format(ledger.contested.length)} of them stand on the foot of their column
            because the store also files that pair as an agreement.{' '}
            {notes.status === 'ready'
              ? `The detector's own note came back for ${nf.format(notes.returned)} of them — the endpoint caps its list at 1,000${filter ? `, and ${nf.format(built.total)} of those cite ${SIGNAL_NAME[filter]}` : ''}.`
              : notes.status === 'loading'
                ? 'Reading the detector’s notes.'
                : `The detector’s notes are unavailable (${notes.reason}), so the reading falls back to the 80-character label.`}
          </p>
        )}
      </div>
    </section>
  );
}

// ─── The reading ────────────────────────────────────────────────────────────

function Pane({
  node,
  text,
  notesReady,
  selected,
  onSelect,
  reducedMotion,
}: {
  node: ObsNode;
  text: string | undefined;
  notesReady: boolean;
  selected: boolean;
  onSelect: () => void;
  reducedMotion: boolean;
}) {
  return (
    <article className="dl-pane">
      <button
        type="button"
        className={`dl-pane-head${reducedMotion ? ' dl-still' : ''}`}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className="dl-pane-label">{node.label}</span>
      </button>
      <dl className="dl-meta">
        <dt>kind</dt>
        <dd>{node.type}</dd>
        <dt>retention</dt>
        <dd>{RETENTION_LABEL[node.retentionBand]}</dd>
        <dt>importance</dt>
        <dd>{node.importance.toFixed(2)}</dd>
        <dt>stored</dt>
        <dd>
          {df.format(new Date(node.createdAt))}, read {nf.format(node.accessCount)} times
        </dd>
        <dt>links</dt>
        <dd>
          {nf.format(node.agreeDegree)} agreeing, {nf.format(node.contradictDegree)} contradicting
        </dd>
      </dl>
      <div className={`dl-text${text ? '' : ' dl-text-missing'}`}>
        {text ??
          (notesReady
            ? 'The detector’s note for this pair was outside the 1,000 the endpoint returns, so only the 80-character label above is available here.'
            : 'Full text arrives with the detector’s notes.')}
      </div>
    </article>
  );
}

function Verdict({
  row,
  left,
  right,
  note,
  notes,
  maxOutAgrees,
}: {
  row: PairRow;
  left: string | undefined;
  right: string | undefined;
  note: DetectorNote | undefined;
  notes: Notes;
  maxOutAgrees: number;
}) {
  const level = ['weak', 'mid', 'strong'] as const;
  const overlap = useMemo(
    () => (left !== undefined && right !== undefined ? overlapOf(left, right) : null),
    [left, right]
  );

  return (
    <div className="dl-verdict">
      <div className={`dl-entry${row.contra ? '' : ' dl-entry-absent'}`}>
        <span
          className="dl-swatch"
          style={{
            background: row.contra ? `var(--contradicts-${level[row.contra.step]})` : 'var(--rule)',
          }}
          aria-hidden
        />
        <span className="dl-entry-name">contradicts</span>
        <span className="dl-entry-fig">{row.contra ? row.contra.strength.toFixed(3) : 'none'}</span>
        <span className="dl-entry-note">
          {row.contra
            ? `the detector’s confidence, ${level[row.contra.step]} step`
            : 'nothing has ever raised a contradiction about this pair'}
        </span>
      </div>
      <div className={`dl-entry${row.agree ? '' : ' dl-entry-absent'}`}>
        <span
          className="dl-swatch"
          style={{
            background: row.agree ? `var(--agrees-${level[row.agree.step]})` : 'var(--rule)',
          }}
          aria-hidden
        />
        <span className="dl-entry-name">relates_to</span>
        <span className="dl-entry-fig">{row.agree ? row.agree.strength.toFixed(2) : 'none'}</span>
        <span className="dl-entry-note">
          {row.agree
            ? `cosine similarity, ${level[row.agree.step]} step${row.contra ? ' — so this pair sits in both books' : ''}`
            : `no memory here is the source of more than ${nf.format(maxOutAgrees)} agreements, so most similar pairs never get this row`}
        </span>
      </div>

      <div className="dl-double" aria-hidden />

      <div className="dl-total">
        <span className="dl-entry-name">shared words</span>
        <span className="dl-entry-fig">{overlap ? `${Math.round(overlap.ratio * 100)}%` : '—'}</span>
        <span className="dl-entry-note">
          {overlap
            ? `${nf.format(overlap.shared)} of ${nf.format(overlap.union)} content words, four letters or more, appear in both texts`
            : !row.contra
              ? 'the full text comes with a contradiction’s note, and this pair carries no contradiction'
              : notes.status === 'ready'
                ? 'both full texts are needed to compute this, and this pair’s note was outside the 1,000 returned'
                : 'computed once both full texts arrive'}
        </span>
      </div>

      <p className="dl-reasons">
        {!row.contra ? (
          'Nothing has raised a contradiction about this pair, so there is no reason to record. It is drawn because the agreement book holds every relates_to edge, contested or not.'
        ) : note && note.signals.length > 0 ? (
          <>
            The detector fired{' '}
            <b>{note.signals.map((s) => SIGNAL_NAME[s] ?? s).join(', ')}</b>
            {note.signals.length === 1 && SIGNAL_GLOSS[note.signals[0]!]
              ? ` — ${SIGNAL_GLOSS[note.signals[0]!]}`
              : ''}
            {note.strategy ? `, and suggests you ${STRATEGY_NAME[note.strategy] ?? note.strategy}.` : '.'}
          </>
        ) : notes.status === 'ready' ? (
          'No note for this contradiction came back in the 1,000 the endpoint returns, so the reason it was raised is not on record here.'
        ) : notes.status === 'loading' ? (
          'Reading the detector’s reason.'
        ) : (
          'The detector’s reasons are unavailable.'
        )}
      </p>
    </div>
  );
}

function Reading({
  data,
  ledger,
  notes,
  row,
  siblings,
  position,
  walkName,
  onStep,
  selectedId,
  onSelect,
  narrow,
  reducedMotion,
}: {
  data: ObsData;
  ledger: Ledger;
  notes: Notes;
  row: PairRow | null;
  siblings: number;
  position: number;
  walkName: string;
  onStep: (delta: number) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  narrow: boolean;
  reducedMotion: boolean;
}) {
  const selectedNode = selectedId ? data.nodes.find((n) => n.id === selectedId) ?? null : null;

  if (!row) {
    return (
      <section className="dl-read" aria-label="The reading">
        <div className="dl-read-head">
          <span className="dl-where">nothing open</span>
        </div>
        <div className="dl-empty">
          {selectedNode ? (
            <>
              <p className="obs-note">
                {selectedNode.label}
              </p>
              <p className="dl-empty-sub">
                Carried over from another view, and it holds no contradiction:{' '}
                {nf.format(selectedNode.agreeDegree)} agrees, none contradicting, in a store where{' '}
                {nf.format(ledger.memoriesWithContradiction)} of {nf.format(data.stats.memories)}{' '}
                memories appear in at least one. Pick a mark on the left to read a disagreement.
              </p>
            </>
          ) : (
            <>
              <p className="obs-note">
                Pick any mark on the left and the two memories it joins are read here, side by side,
                with what the store recorded about them.
              </p>
              <p className="dl-empty-sub">
                {nf.format(data.stats.memories)} memories carry {nf.format(ledger.distinctLabels)}{' '}
                distinct labels between them, so at label resolution a duplicate and a disagreement
                look the same. That is why this half of the plate reads the text.
              </p>
            </>
          )}
        </div>
      </section>
    );
  }

  const a = data.nodes[row.a]!;
  const b = data.nodes[row.b]!;
  const note = row.contra ? notes.byEdge.get(row.contra.id) : undefined;
  const textA = notes.text.get(a.id);
  const textB = notes.text.get(b.id);

  return (
    <section className="dl-read" aria-label="The reading">
      <div className="dl-read-head">
        <span className="dl-where">
          {row.agree && row.contra
            ? 'contested pair — both books hold it'
            : row.contra
              ? 'contradiction only'
              : 'agreement only'}
          {position >= 0 && siblings > 1
            ? ` · ${nf.format(position + 1)} of ${nf.format(siblings)} ${walkName}`
            : ''}
        </span>
        <button
          type="button"
          className={`dl-step${reducedMotion ? ' dl-still' : ''}`}
          onClick={() => onStep(-1)}
          disabled={siblings < 2}
          aria-label={`Previous of the ${nf.format(siblings)} ${walkName}`}
        >
          &lsaquo; previous
        </button>
        <button
          type="button"
          className={`dl-step${reducedMotion ? ' dl-still' : ''}`}
          onClick={() => onStep(1)}
          disabled={siblings < 2}
          aria-label={`Next of the ${nf.format(siblings)} ${walkName}`}
        >
          next &rsaquo;
        </button>
      </div>

      <div
        className={`dl-panes${narrow ? ' dl-stacked' : ''}`}
        style={{
          gridTemplateColumns: narrow ? '1fr' : '1fr 1fr',
          gridAutoRows: narrow ? 'minmax(0, 1fr)' : undefined,
        }}
      >
        <Pane
          node={a}
          text={textA}
          notesReady={notes.status === 'ready'}
          selected={selectedId === a.id}
          onSelect={() => onSelect(a.id)}
          reducedMotion={reducedMotion}
        />
        <Pane
          node={b}
          text={textB}
          notesReady={notes.status === 'ready'}
          selected={selectedId === b.id}
          onSelect={() => onSelect(b.id)}
          reducedMotion={reducedMotion}
        />
      </div>

      <Verdict
        row={row}
        left={textA}
        right={textB}
        note={note}
        notes={notes}
        maxOutAgrees={ledger.maxOutAgrees}
      />
    </section>
  );
}

// ─── Plate ──────────────────────────────────────────────────────────────────

function Plate({ data, width, height, reducedMotion, selectedId, onSelect }: DemoProps) {
  const ledger = useMemo(() => buildLedger(data), [data]);
  const notes = useDetectorNotes();
  const [book, setBook] = useState<BookId>('confidence');
  const [filter, setFilter] = useState<SignalName | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const narrow = width < NARROW_AT;
  const short = height < SHORT_AT;
  const mastH = Math.min(MAST_H, Math.max(64, height * 0.14));
  const bodyH = Math.max(120, height - mastH);
  const docketW = narrow ? width : Math.round(Math.max(340, Math.min(width * 0.44, 620)));
  const docketH = narrow ? Math.round(bodyH * 0.46) : bodyH;

  // A memory arriving from another demo opens its strongest contradiction, so a
  // selection lands in context rather than being dropped.
  useEffect(() => {
    if (!selectedId) return;
    const open = openKey ? ledger.byKey.get(openKey) : undefined;
    if (open && (data.nodes[open.a]!.id === selectedId || data.nodes[open.b]!.id === selectedId)) return;
    const list = ledger.byMemory.get(selectedId)?.filter((r) => r.contra !== null);
    setOpenKey(list && list.length > 0 ? list[0]!.key : null);
  }, [selectedId, ledger, data.nodes, openKey]);

  const openRow = openKey ? ledger.byKey.get(openKey) ?? null : null;

  // Stepping moves through the selected memory's own docket — every
  // contradiction it is party to — and falls back to the whole ledger when
  // nothing is selected. Naming which of the two is in play matters: the
  // reader has to know what "next" means.
  const walk = useMemo(() => {
    const inBook = (r: PairRow) => (book === 'confidence' ? r.contra !== null : r.agree !== null);
    if (selectedId) {
      const list = ledger.byMemory.get(selectedId)?.filter(inBook);
      if (list && list.length > 0) return list;
    }
    return book === 'confidence' ? ledger.contradicting : ledger.agreeing;
  }, [book, selectedId, ledger.byMemory, ledger.contradicting, ledger.agreeing]);

  const onSelectedMemory = Boolean(selectedId && ledger.byMemory.has(selectedId));
  const walkName = onSelectedMemory
    ? 'on this memory'
    : book === 'confidence'
      ? 'renderable contradictions'
      : 'renderable agreements';

  const position = openRow ? walk.findIndex((r) => r.key === openRow.key) : -1;

  const step = useCallback(
    (delta: number) => {
      if (walk.length === 0) return;
      // From an unknown position, either direction lands on the first entry.
      const next = position < 0 ? walk[0] : walk[(position + delta + walk.length) % walk.length];
      if (next) setOpenKey(next.key);
    },
    [walk, position]
  );

  const open = useCallback(
    (row: PairRow) => {
      setOpenKey(row.key);
      const a = data.nodes[row.a]!;
      const b = data.nodes[row.b]!;
      if (selectedId !== a.id && selectedId !== b.id) onSelect(a.id);
    },
    [data.nodes, onSelect, selectedId]
  );

  return (
    <div
      className="dl"
      style={{
        gridTemplateRows: narrow ? `${mastH}px ${docketH}px 1fr` : `${mastH}px 1fr`,
        gridTemplateColumns: narrow ? '1fr' : `${docketW}px 1fr`,
      }}
    >
      <style>{CSS}</style>
      <Reconciliation data={data} ledger={ledger} width={width} tight={narrow} />
      <Docket
        data={data}
        ledger={ledger}
        notes={notes}
        book={book}
        onBook={setBook}
        filter={filter}
        onFilter={setFilter}
        width={docketW}
        height={docketH}
        openKey={openKey}
        onOpen={open}
        reducedMotion={reducedMotion}
      />
      <Reading
        data={data}
        ledger={ledger}
        notes={notes}
        row={openRow}
        siblings={walk.length}
        position={position}
        walkName={walkName}
        onStep={step}
        selectedId={selectedId}
        onSelect={onSelect}
        narrow={narrow || short}
        reducedMotion={reducedMotion}
      />
    </div>
  );
}

export const contradictionLedger: DemoModule = {
  id: 'contradiction-ledger',
  name: 'Read the disagreement',
  dimension: 'Hybrid',
  claim:
    'Every contradiction in this store is also a similarity claim — no agreement below cosine 0.65 is ever contested, and none above it is safe — so the pairs marked both ways are one measurement filed into two books; any pair here whose two texts genuinely say opposite things falsifies that.',
  Plate,
};
