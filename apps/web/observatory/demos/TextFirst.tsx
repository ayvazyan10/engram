import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RETENTION_LABEL,
  linkColor,
  type DemoModule,
  type DemoProps,
  type LinkKind,
  type ObsData,
  type ObsNode,
} from './contract';

/**
 * SLOT — hybrid. "Read, then trace."
 *
 * Every other plate in this harness turns a memory into a dot. This one does
 * not. The overview is the writing, set as writing; the detail is the two
 * sentences a link actually joins.
 *
 * ─── The risk, taken first ─────────────────────────────────────────────────
 *
 * Text does not scale to 652 items on one plate and a list is not a
 * visualization. Both objections are real, and both are answered by the same
 * measurement, made on this store before a line of this file was written:
 *
 *   THE STORE REPEATS ITSELF. 652 memories carry only 242 distinct labels —
 *   a 2.7x compression that costs nothing, because every distinct sentence
 *   survives it. Six sentences account for 321 memories. "# Knowledge Gap
 *   Analysis" is stored 90 times.
 *
 *   AND THE REPETITION IS THE GRAPH. 2,002 of the 3,101 renderable links —
 *   65% — join two memories whose labels are character-for-character
 *   identical. The hairball every 3D view of this store draws is, for the
 *   most part, one sentence talking to copies of itself. No dot cloud can
 *   show that. Grouping by the text shows it in the first row.
 *
 *   AND IT COLLAPSES THE DETAIL TOO. Group a memory's neighbours by what
 *   they say and the busiest memory in the store — degree 66 — has seven
 *   distinct sentences on the other end of its links. Median 2, 90th
 *   percentile 5, maximum 14, across all 615 connected memories. So the
 *   detail view never has to truncate, aggregate or paginate: every
 *   neighbouring sentence of every memory fits on the plate, always.
 *
 * Nothing above is typed into the render. Every figure the plate prints is
 * recomputed from `data` on load, so it stays true as the store grows.
 *
 * ─── The instrument ────────────────────────────────────────────────────────
 *
 * A critical apparatus. The census on the left is the text with its argument
 * load ruled beneath it; the passage on the right is one memory and the
 * sentences it is joined to, each bracketed in the margin by the relation.
 *
 * THE CENSUS. One row per distinct sentence, ranked. A single hairline runs
 * the whole height of the column at its centre — that line is zero, and it is
 * the only piece of chrome in the view. Under each sentence, two bars grow
 * off it:
 *
 *          agrees  <-- |  --> contradicts
 *   upper track    ====|=======            with OTHER sentences
 *   lower track     ===|====               among ITS OWN copies
 *
 * so the four quadrants are: agrees outward, contradicts outward, agrees
 * inward, contradicts inward. A row whose lower track is empty is a sentence
 * said once. A row that is all lower track is the reflection engine arguing
 * with itself. You cannot read the sentence without reading its argument,
 * because the bar is attached to it and hangs off a line you can see.
 *
 * BAR LENGTH IS LINKS PER MEMORY, not links. A self link touches two copies,
 * a cross link one, so the four lengths sum to exactly the MEAN DEGREE of the
 * memories carrying that sentence. That is what makes one linear scale work
 * at all: raw counts run 1 to 632 and a linear bar would show nothing below
 * the top six rows, while the rate runs 0 to 17 with a median of 3. Counts
 * are not lost — they are the strip of ticks beside the bar, one tick per
 * memory, each as tall as that memory's own degree. Two encodings, two
 * different questions, no redundancy.
 *
 * Ranking is a control, because no single order is honest here. By links per
 * memory the top of the list mixes the reflection boilerplate with real
 * single memories that happen to be heavily argued ("engram vector index
 * persistence and multi-process conflict", 14 links, stored once). By total
 * links the six loud reflections take the whole first screen — which is the
 * finding, stated by the ordering itself. Filtering is the third control, and
 * the one a text view earns by being text: press / and type.
 *
 * THE PASSAGE. The memory being read, set large, then every sentence its
 * links reach, grouped. An agreement is a rule in the LEFT margin of that
 * sentence, a contradiction a rule in the RIGHT margin — the same left/right
 * convention as the census axis, so kind is carried by position as well as by
 * hue, and hue is never the only channel. Rule thickness and level are the
 * strongest link of that kind, off the token ramp.
 *
 * A sentence ruled on BOTH margins is a pair the store says both belongs
 * together and conflicts. Measured: 459 memory pairs are joined both ways,
 * and 416 of the 615 connected memories have at least one such sentence in
 * their neighbourhood. It is not an edge case, it is the normal condition of
 * this store, and bracketing the sentence on both sides is the only way I
 * know to show it as what it is — a disagreement about one piece of writing.
 *
 * Clicking a neighbouring sentence selects a real memory on the other end of
 * a real link, so the passage walks. That is the "then trace".
 *
 * ─── The rules, and how they are met ───────────────────────────────────────
 *
 * 3. No colour literals. Bars use var(--agrees) / var(--contradicts); the
 *    marginal rules use linkColor(), the contract's own accessor. Every other
 *    value is a token.
 * 4. Density is geometry. Bar length, tick height, the number of ticks. There
 *    is no wash anywhere and no alpha is spent on density, so every mark sits
 *    at its full token colour, above the 3:1 floor.
 * 5. Retention is never colour. It is the band's word plus a ring whose
 *    RADIUS is the retained fraction, in the passage only — 87% of this store
 *    is in one band, so spending a column on it in the census would be
 *    spending the reader's attention on a constant.
 * 6. reducedMotion. There is no simulation, no autorotation and no entrance
 *    animation to suppress; the one thing it gates is whether the census
 *    scrolls smoothly or jumps when a selection arrives.
 * 7. Nothing transitions at all — hover and selection are instant changes of
 *    ink, and no width, height or padding on this plate ever moves.
 * 8. Denominators are on screen: distinct sentences against memories, links
 *    inside one sentence against links drawn, and the archived links that
 *    cannot be counted at all. Filtering restates all of them live.
 * 9. Two regions, bleeding to the edges. No card, no radius, no shadow.
 */

// ─── Derivation ─────────────────────────────────────────────────────────────

type Quadrant = 'crossA' | 'crossC' | 'selfA' | 'selfC';

/** One distinct thing the store says, and every memory that says it. */
interface Utterance {
  index: number;
  label: string;
  search: string;
  /** Node indices, ordered by degree so `members[0]` is the busiest copy. */
  members: number[];
  copies: number;
  crossA: number;
  crossC: number;
  selfA: number;
  selfC: number;
  /** Renderable links with at least one endpoint carrying this sentence. */
  links: number;
  /** The four quadrant lengths, normalised per memory. Their sum is the mean
   *  degree of `members`, which is why one linear scale can serve all four. */
  perCopy: Record<Quadrant, number>;
  meanDegree: number;
  newest: number;
}

interface Edge {
  other: number;
  kind: LinkKind;
  step: 0 | 1 | 2;
}

interface Reading {
  utterances: Utterance[];
  utteranceOf: Int32Array;
  adjacency: Edge[][];
  indexOfId: Map<string, number>;
  componentSize: Map<number, number>;
  /** Shared domain for all four quadrants, so lengths compare across tracks. */
  vmax: number;
  selfLinks: number;
  crossLinks: number;
  bothWaysPairs: number;
}

function blankQuadrants(): Record<Quadrant, number> {
  return { crossA: 0, crossC: 0, selfA: 0, selfC: 0 };
}

/**
 * Everything the plate needs, in one pass over the store. Accumulation is
 * local to this call and nothing built here is shared with another demo.
 */
function derive(data: ObsData): Reading {
  const { nodes, links } = data;

  const byLabel = new Map<string, Utterance>();
  const utterances: Utterance[] = [];
  const utteranceOf = new Int32Array(nodes.length);
  const indexOfId = new Map<string, number>();
  const componentSize = new Map<number, number>();

  nodes.forEach((node, i) => {
    indexOfId.set(node.id, i);
    componentSize.set(node.component, (componentSize.get(node.component) ?? 0) + 1);
    let utterance = byLabel.get(node.label);
    if (!utterance) {
      utterance = {
        index: utterances.length,
        label: node.label,
        search: node.label.toLowerCase(),
        members: [],
        copies: 0,
        crossA: 0,
        crossC: 0,
        selfA: 0,
        selfC: 0,
        links: 0,
        perCopy: blankQuadrants(),
        meanDegree: 0,
        newest: 0,
      };
      byLabel.set(node.label, utterance);
      utterances.push(utterance);
    }
    utterance.members.push(i);
    utteranceOf[i] = utterance.index;
  });

  const adjacency: Edge[][] = nodes.map(() => []);
  const pairKinds = new Map<number, number>();
  const stride = nodes.length;
  let selfLinks = 0;

  for (const link of links) {
    const { source, target, kind, step } = link;
    adjacency[source]!.push({ other: target, kind, step });
    adjacency[target]!.push({ other: source, kind, step });

    const a = utterances[utteranceOf[source]!]!;
    const b = utterances[utteranceOf[target]!]!;
    if (a === b) {
      selfLinks++;
      if (kind === 'agrees') a.selfA++;
      else a.selfC++;
    } else if (kind === 'agrees') {
      a.crossA++;
      b.crossA++;
    } else {
      a.crossC++;
      b.crossC++;
    }

    const low = Math.min(source, target);
    const high = Math.max(source, target);
    const key = low * stride + high;
    pairKinds.set(key, (pairKinds.get(key) ?? 0) | (kind === 'agrees' ? 1 : 2));
  }

  let bothWaysPairs = 0;
  for (const mask of pairKinds.values()) if (mask === 3) bothWaysPairs++;

  let vmax = 1;
  for (const u of utterances) {
    u.copies = u.members.length;
    u.links = u.crossA + u.crossC + u.selfA + u.selfC;
    u.perCopy = {
      crossA: u.crossA / u.copies,
      crossC: u.crossC / u.copies,
      selfA: (u.selfA * 2) / u.copies,
      selfC: (u.selfC * 2) / u.copies,
    };
    u.meanDegree =
      u.perCopy.crossA + u.perCopy.crossC + u.perCopy.selfA + u.perCopy.selfC;
    u.members.sort((i, j) => nodes[j]!.degree - nodes[i]!.degree);
    let newest = 0;
    for (const i of u.members) {
      const at = Date.parse(nodes[i]!.createdAt);
      if (at > newest) newest = at;
    }
    u.newest = newest;
    for (const value of Object.values(u.perCopy)) if (value > vmax) vmax = value;
  }

  return {
    utterances,
    utteranceOf,
    adjacency,
    indexOfId,
    componentSize,
    vmax,
    selfLinks,
    crossLinks: links.length - selfLinks,
    bothWaysPairs,
  };
}

// ─── The passage's neighbour groups ─────────────────────────────────────────

interface NeighbourGroup {
  utterance: Utterance;
  agree: number;
  contradict: number;
  agreeStep: 0 | 1 | 2;
  contradictStep: 0 | 1 | 2;
  memories: number;
  /** The busiest adjacent memory carrying this sentence — the walk target. */
  target: number;
  sameSentence: boolean;
}

function neighboursOf(reading: Reading, nodes: ObsNode[], focus: number): NeighbourGroup[] {
  const own = reading.utteranceOf[focus]!;
  const groups = new Map<number, NeighbourGroup & { seen: Set<number> }>();

  for (const edge of reading.adjacency[focus] ?? []) {
    const key = reading.utteranceOf[edge.other]!;
    let group = groups.get(key);
    if (!group) {
      group = {
        utterance: reading.utterances[key]!,
        agree: 0,
        contradict: 0,
        agreeStep: 0,
        contradictStep: 0,
        memories: 0,
        target: edge.other,
        sameSentence: key === own,
        seen: new Set<number>(),
      };
      groups.set(key, group);
    }
    if (edge.kind === 'agrees') {
      group.agree++;
      if (edge.step > group.agreeStep) group.agreeStep = edge.step;
    } else {
      group.contradict++;
      if (edge.step > group.contradictStep) group.contradictStep = edge.step;
    }
    group.seen.add(edge.other);
    if (nodes[edge.other]!.degree > nodes[group.target]!.degree) group.target = edge.other;
  }

  const out: NeighbourGroup[] = [];
  for (const group of groups.values()) {
    group.memories = group.seen.size;
    out.push(group);
  }
  return out.sort((a, b) => {
    const bothA = a.agree > 0 && a.contradict > 0 ? 1 : 0;
    const bothB = b.agree > 0 && b.contradict > 0 ? 1 : 0;
    if (bothA !== bothB) return bothB - bothA;
    return b.agree + b.contradict - (a.agree + a.contradict);
  });
}

// ─── Ranking ────────────────────────────────────────────────────────────────

type Order = 'rate' | 'total' | 'newest';

const ORDERS: readonly { id: Order; name: string }[] = [
  { id: 'rate', name: 'Links per memory' },
  { id: 'total', name: 'Total links' },
  { id: 'newest', name: 'Newest' },
];

function rank(utterances: Utterance[], order: Order): Utterance[] {
  const sorted = [...utterances];
  if (order === 'newest') sorted.sort((a, b) => b.newest - a.newest || b.copies - a.copies);
  else if (order === 'total') sorted.sort((a, b) => b.links - a.links || b.copies - a.copies);
  else sorted.sort((a, b) => b.meanDegree - a.meanDegree || b.copies - a.copies);
  return sorted;
}

// ─── Formatting ─────────────────────────────────────────────────────────────

const nf = new Intl.NumberFormat('en-US');
const df = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const rate = (value: number) => (value >= 10 ? value.toFixed(0) : value.toFixed(1));

/** Bar length as a percentage of the row: the axis sits at 50%, so each half
 *  is 50% wide and the longest bar in the store reaches 48 of it. */
function barWidth(value: number, vmax: number): string {
  if (value <= 0) return '0%';
  return `${Math.max(0.45, (value / vmax) * 48).toFixed(3)}%`;
}

// ─── Marks ──────────────────────────────────────────────────────────────────

function Apparatus({ utterance, vmax }: { utterance: Utterance; vmax: number }) {
  const p = utterance.perCopy;
  const title =
    `Per memory saying this: ${rate(p.crossA)} agree and ${rate(p.crossC)} contradict ` +
    `other sentences; ${rate(p.selfA)} agree and ${rate(p.selfC)} contradict other copies ` +
    `of this same sentence.`;
  return (
    <span className="tf-app" title={title} aria-hidden>
      <span className="tf-bar tf-a tf-outer" style={{ width: barWidth(p.crossA, vmax) }} />
      <span className="tf-bar tf-c tf-outer" style={{ width: barWidth(p.crossC, vmax) }} />
      <span className="tf-bar tf-a tf-inner" style={{ width: barWidth(p.selfA, vmax) }} />
      <span className="tf-bar tf-c tf-inner" style={{ width: barWidth(p.selfC, vmax) }} />
    </span>
  );
}

function Strip({
  utterance,
  nodes,
  maxDegree,
  selectedId,
  onPick,
}: {
  utterance: Utterance;
  nodes: ObsNode[];
  maxDegree: number;
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <span
      className="tf-strip"
      onClick={(event) => {
        const id = (event.target as HTMLElement).dataset['memory'];
        if (!id) return;
        event.stopPropagation();
        onPick(id);
      }}
    >
      {utterance.members.map((i) => {
        const node = nodes[i]!;
        const height = 2 + 9 * Math.sqrt(node.degree / maxDegree);
        return (
          <span
            key={node.id}
            className="tf-tick"
            data-memory={node.id}
            data-live={node.id === selectedId}
            style={{ height: `${height.toFixed(1)}px` }}
            title={`${node.degree} links, stored ${df.format(new Date(node.createdAt))}`}
          />
        );
      })}
    </span>
  );
}

// ─── The census ─────────────────────────────────────────────────────────────

function Census({
  data,
  reading,
  selectedId,
  onSelect,
  reducedMotion,
  query,
  setQuery,
}: {
  data: ObsData;
  reading: Reading;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  reducedMotion: boolean;
  query: string;
  setQuery: (value: string) => void;
}) {
  const { stats, nodes } = data;
  const [order, setOrder] = useState<Order>('rate');
  const filterRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef(new Map<number, HTMLDivElement>());

  const ranked = useMemo(() => rank(reading.utterances, order), [reading.utterances, order]);
  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () => (needle ? ranked.filter((u) => u.search.includes(needle)) : ranked),
    [ranked, needle]
  );
  const shownMemories = useMemo(() => shown.reduce((sum, u) => sum + u.copies, 0), [shown]);

  const selectedIndex = selectedId ? reading.indexOfId.get(selectedId) : undefined;
  const selectedUtterance = selectedIndex === undefined ? -1 : reading.utteranceOf[selectedIndex]!;

  // A selection arriving from another demo — or from the passage's own walk —
  // brings its sentence into view. 'nearest' so clicking a visible row does
  // not throw the column around, and no smooth scroll under reduced motion.
  useEffect(() => {
    if (selectedUtterance < 0) return;
    const row = rowRefs.current.get(selectedUtterance);
    row?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [selectedUtterance, reducedMotion]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      filterRef.current?.focus();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const pick = useCallback((id: string) => onSelect(id), [onSelect]);

  return (
    <section className="tf-census" aria-label="What the store says">
      <div className="tf-head">
        <div className="tf-figures">
          <span className="tf-fig">
            <span className="obs-label">Distinct sentences</span>
            <span className="obs-figure tf-fig-value">{nf.format(reading.utterances.length)}</span>
            <span className="obs-label">across {nf.format(stats.memories)} memories</span>
          </span>
          <span className="tf-fig">
            <span className="obs-label">Links inside one sentence</span>
            <span className="obs-figure tf-fig-value">{nf.format(reading.selfLinks)}</span>
            <span className="obs-label">of {nf.format(stats.linksDrawn)} drawn</span>
          </span>
          <span className="tf-fig">
            <span className="obs-label">Pairs joined both ways</span>
            <span className="obs-figure tf-fig-value">{nf.format(reading.bothWaysPairs)}</span>
            <span className="obs-label">agree and contradict</span>
          </span>
        </div>

        <div className="tf-controls">
          <input
            ref={filterRef}
            className="tf-filter"
            type="search"
            value={query}
            placeholder="Filter sentences — press /"
            aria-label="Filter sentences"
            onChange={(event) => setQuery(event.target.value)}
            // The page switches demos on the 1–9 keys, listening on the window,
            // so typing a digit into a filter would otherwise navigate away
            // mid-word — "3090" and "2026" both occur in this store's text.
            onKeyDown={(event) => event.stopPropagation()}
          />
          <div className="tf-order" role="group" aria-label="Order">
            {ORDERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="tf-order-item"
                aria-pressed={item.id === order}
                onClick={() => setOrder(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>

        <p className="obs-label tf-denominator">
          {needle
            ? `Showing ${nf.format(shown.length)} of ${nf.format(reading.utterances.length)} sentences, ${nf.format(shownMemories)} of ${nf.format(stats.memories)} memories.`
            : `Every sentence in the store is here; none is trimmed. ${nf.format(stats.linksToArchived)} further links point at archived memories and cannot be counted.`}
        </p>
      </div>

      <div className="tf-scroll">
        <div className="tf-rows">
          {/* The axis is one element for the whole column, so the zero line is
              continuous from the key at its head to the last row. */}
          <span className="tf-axis" aria-hidden />

          <div className="tf-key">
            <span className="tf-key-line">
              <span className="obs-label tf-key-name">with other sentences</span>
              <span className="tf-bar tf-a tf-key-bar" style={{ width: '18%' }} aria-hidden />
              <span className="tf-bar tf-c tf-key-bar" style={{ width: '18%' }} aria-hidden />
            </span>
            <span className="tf-key-line">
              <span className="obs-label tf-key-name">among its own copies</span>
              <span className="tf-bar tf-a tf-key-bar" style={{ width: '18%' }} aria-hidden />
              <span className="tf-bar tf-c tf-key-bar" style={{ width: '18%' }} aria-hidden />
            </span>
            <span className="obs-label tf-key-scale">
              agrees left of the line, contradicts right, and the longest bar in the store is{' '}
              {rate(reading.vmax)} links per memory. Each tick below a sentence is one memory, as
              tall as its own degree.
            </span>
          </div>

          {shown.length === 0 ? (
            <p className="tf-none">
              No sentence in the store contains that. {nf.format(reading.utterances.length)}{' '}
              sentences were searched.
            </p>
          ) : null}
          {shown.map((utterance) => {
            const live = utterance.index === selectedUtterance;
            return (
              <div
                key={utterance.index}
                className="tf-row"
                data-live={live}
                ref={(element) => {
                  if (element) rowRefs.current.set(utterance.index, element);
                  else rowRefs.current.delete(utterance.index);
                }}
              >
                <button
                  type="button"
                  className="tf-open"
                  aria-pressed={live}
                  onClick={() => pick(nodes[utterance.members[0]!]!.id)}
                >
                  <span className="tf-sentence">{utterance.label}</span>
                  <Apparatus utterance={utterance} vmax={reading.vmax} />
                </button>
                <span className="tf-row-foot">
                  <Strip
                    utterance={utterance}
                    nodes={nodes}
                    maxDegree={Math.max(1, stats.degree.max)}
                    selectedId={selectedId}
                    onPick={pick}
                  />
                  <span className="tf-counts">
                    <span className="obs-figure">{nf.format(utterance.copies)}</span>
                    <span className="obs-label">
                      {utterance.copies === 1 ? 'memory' : 'memories'}
                    </span>
                    <span className="obs-figure">{nf.format(utterance.links)}</span>
                    <span className="obs-label">{utterance.links === 1 ? 'link' : 'links'}</span>
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── The passage ────────────────────────────────────────────────────────────

function Empty({ data, reading }: { data: ObsData; reading: Reading }) {
  const { stats } = data;
  const share = Math.round((reading.selfLinks / Math.max(1, stats.linksDrawn)) * 100);
  return (
    <div className="tf-empty">
      <p className="tf-empty-lead">
        {nf.format(stats.memories)} memories say {nf.format(reading.utterances.length)} distinct
        things.
      </p>
      <p className="tf-empty-note">
        {share}% of the links that can be drawn — {nf.format(reading.selfLinks)} of{' '}
        {nf.format(stats.linksDrawn)} — join two memories whose text is identical. Another{' '}
        {nf.format(stats.linksToArchived)} point at memories that have been archived and cannot be
        drawn at all. {nf.format(reading.bothWaysPairs)} pairs are joined by an agreement and a
        contradiction at the same time.
      </p>
      <p className="tf-empty-note">
        Choose a sentence on the left to read what it is connected to. Clicking a tick chooses one
        particular memory; clicking the sentence chooses its busiest one.
      </p>
    </div>
  );
}

function Fields({
  node,
  utterance,
  componentSize,
  copyIndex,
}: {
  node: ObsNode;
  utterance: Utterance;
  componentSize: number;
  copyIndex: number;
}) {
  return (
    <div className="tf-fields">
      <span className="tf-field">
        <span className="obs-label">Kind</span>
        <span className="obs-figure">{node.type}</span>
      </span>
      <span className="tf-field">
        <span className="obs-label">Retention</span>
        <span className="obs-figure tf-retention">
          <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden focusable="false">
            <circle
              cx="6.5"
              cy="6.5"
              r={1.6 + 4.2 * node.retention}
              fill="none"
              stroke="var(--ink-3)"
              strokeWidth="1"
            />
          </svg>
          {RETENTION_LABEL[node.retentionBand]}
        </span>
      </span>
      <span className="tf-field">
        <span className="obs-label">Stored</span>
        <span className="obs-figure">{df.format(new Date(node.createdAt))}</span>
      </span>
      <span className="tf-field">
        <span className="obs-label">Read</span>
        <span className="obs-figure">{nf.format(node.accessCount)} times</span>
      </span>
      <span className="tf-field">
        <span className="obs-label">Links</span>
        <span className="obs-figure">
          {nf.format(node.agreeDegree)} agree, {nf.format(node.contradictDegree)} contradict
        </span>
      </span>
      <span className="tf-field">
        <span className="obs-label">Cluster</span>
        <span className="obs-figure">{nf.format(componentSize)} memories</span>
      </span>
      <span className="tf-field">
        <span className="obs-label">This sentence</span>
        <span className="obs-figure">
          copy {nf.format(copyIndex + 1)} of {nf.format(utterance.copies)}
        </span>
      </span>
    </div>
  );
}

function Passage({
  data,
  reading,
  selectedId,
  onSelect,
  filteredOut,
}: {
  data: ObsData;
  reading: Reading;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  filteredOut: boolean;
}) {
  const { nodes } = data;
  const focusIndex = selectedId ? reading.indexOfId.get(selectedId) : undefined;
  const groups = useMemo(
    () => (focusIndex === undefined ? [] : neighboursOf(reading, nodes, focusIndex)),
    [reading, nodes, focusIndex]
  );

  if (focusIndex === undefined) {
    return (
      <section className="tf-passage" aria-label="The memory being read">
        <Empty data={data} reading={reading} />
      </section>
    );
  }

  const node = nodes[focusIndex]!;
  const utterance = reading.utterances[reading.utteranceOf[focusIndex]!]!;
  const copyIndex = utterance.members.indexOf(focusIndex);
  const bothWays = groups.filter((g) => g.agree > 0 && g.contradict > 0).length;
  const previous = copyIndex > 0 ? utterance.members[copyIndex - 1] : undefined;
  const next = copyIndex < utterance.copies - 1 ? utterance.members[copyIndex + 1] : undefined;

  return (
    <section className="tf-passage" aria-label="The memory being read">
      <div className="tf-focus">
        <p className="tf-focus-text">{node.label}</p>
        <Fields
          node={node}
          utterance={utterance}
          componentSize={reading.componentSize.get(node.component) ?? 1}
          copyIndex={copyIndex}
        />
        <div className="tf-walk">
          <button
            type="button"
            className="tf-walk-item"
            disabled={previous === undefined}
            onClick={() => previous !== undefined && onSelect(nodes[previous]!.id)}
          >
            Previous copy
          </button>
          <button
            type="button"
            className="tf-walk-item"
            disabled={next === undefined}
            onClick={() => next !== undefined && onSelect(nodes[next]!.id)}
          >
            Next copy
          </button>
          <button type="button" className="tf-walk-item" onClick={() => onSelect(null)}>
            Clear
          </button>
          {filteredOut ? (
            <span className="obs-label tf-walk-note">
              this sentence is outside the current filter
            </span>
          ) : null}
        </div>
      </div>

      <div className="tf-nbs">
        <p className="obs-label tf-nbs-head">
          {node.degree === 0
            ? 'This memory has no renderable link. It is one of ' +
              nf.format(data.stats.isolated) +
              ' with none.'
            : `Its ${nf.format(node.degree)} links reach ${nf.format(groups.length)} distinct ${
                groups.length === 1 ? 'sentence' : 'sentences'
              }, all shown${
                bothWays > 0
                  ? ` — ${nf.format(bothWays)} ruled on both margins, agreed with and contradicted at once`
                  : ''
              }.`}
        </p>

        {groups.map((group) => {
          const target = nodes[group.target]!;
          return (
            <button
              key={group.utterance.index}
              type="button"
              className="tf-nb"
              onClick={() => onSelect(target.id)}
            >
              <span
                className="tf-nb-rule tf-nb-left"
                style={
                  group.agree > 0
                    ? {
                        background: linkColor({ kind: 'agrees', step: group.agreeStep }),
                        width: `${2 + group.agreeStep}px`,
                      }
                    : undefined
                }
                aria-hidden
              />
              <span className="tf-nb-body">
                <span className="tf-nb-text">{group.utterance.label}</span>
                <span className="tf-nb-meta">
                  {group.agree > 0 ? (
                    <span className="tf-nb-count">
                      <span className="obs-figure">{nf.format(group.agree)}</span>
                      <span className="obs-label">agree</span>
                    </span>
                  ) : null}
                  {group.contradict > 0 ? (
                    <span className="tf-nb-count">
                      <span className="obs-figure">{nf.format(group.contradict)}</span>
                      <span className="obs-label">contradict</span>
                    </span>
                  ) : null}
                  <span className="tf-nb-count">
                    <span className="obs-figure">{nf.format(group.memories)}</span>
                    <span className="obs-label">
                      {group.memories === 1 ? 'memory' : 'memories'}
                      {group.sameSentence ? ' saying this same sentence' : ''}
                    </span>
                  </span>
                </span>
              </span>
              <span
                className="tf-nb-rule tf-nb-right"
                style={
                  group.contradict > 0
                    ? {
                        background: linkColor({
                          kind: 'contradicts',
                          step: group.contradictStep,
                        }),
                        width: `${2 + group.contradictStep}px`,
                      }
                    : undefined
                }
                aria-hidden
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ─── Plate ──────────────────────────────────────────────────────────────────

function Plate({ data, width, reducedMotion, selectedId, onSelect }: DemoProps) {
  const reading = useMemo(() => derive(data), [data]);
  // The filter lives here rather than in the census so the passage can say
  // when the memory you are reading has been filtered out of the column.
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const selectedIndex = selectedId ? reading.indexOfId.get(selectedId) : undefined;
  const filteredOut =
    needle.length > 0 &&
    selectedIndex !== undefined &&
    !reading.utterances[reading.utteranceOf[selectedIndex]!]!.search.includes(needle);

  return (
    <div className="tf-root" data-stacked={width < 940}>
      <style>{CSS}</style>
      <Census
        data={data}
        reading={reading}
        selectedId={selectedId}
        onSelect={onSelect}
        reducedMotion={reducedMotion}
        query={query}
        setQuery={setQuery}
      />
      <Passage
        data={data}
        reading={reading}
        selectedId={selectedId}
        onSelect={onSelect}
        filteredOut={filteredOut}
      />
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const CSS = `
.tf-root { position:absolute; inset:0; display:grid; min-width:0; min-height:0;
  background: var(--plate); }
.tf-root[data-stacked="false"] { grid-template-columns: minmax(0,46fr) minmax(0,54fr); }
.tf-root[data-stacked="true"] { grid-template-rows: minmax(0,1fr) minmax(0,1fr); }

/* ── census ────────────────────────────────────────────────────────────── */
.tf-census { display:flex; flex-direction:column; min-width:0; min-height:0; }
.tf-head { padding:14px 22px 12px; border-bottom:1px solid var(--rule); }

.tf-figures { display:flex; flex-wrap:wrap; gap:0 20px; }
.tf-fig { display:flex; flex-direction:column; }
.tf-fig-value { font-size: var(--t-figure); line-height:1.2; }

.tf-controls { display:flex; align-items:center; gap:12px; margin-top: var(--gap-block); }
.tf-filter { flex:1 1 auto; min-width:0; font:inherit; font-size: var(--t-body);
  color: var(--ink); background: var(--margin); border:1px solid var(--rule);
  padding:5px 9px; }
.tf-filter::placeholder { color: var(--ink-3); }
.tf-order { display:flex; gap:1px; background: var(--rule); flex:0 0 auto; }
.tf-order-item { padding:5px 10px; background: var(--plate); color: var(--ink-3);
  font-size: var(--t-label); font-stretch:78%; font-weight:500; }
.tf-order-item:hover { color: var(--ink-2); }
.tf-order-item[aria-pressed="true"] { background: var(--rule); color: var(--ink); }

.tf-denominator { margin: var(--gap-block) 0 0; max-width:62ch; }

.tf-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden;
  padding:0 22px 48px; }
.tf-rows { position:relative; }
.tf-axis { position:absolute; left:50%; top:0; bottom:0; width:1px;
  background: var(--rule); }
.tf-none { font-family: var(--font-note); font-weight:300; font-size: var(--t-claim);
  color: var(--ink-2); max-width:62ch; padding-top:20px; }

/* The key is the head of the axis: the same zero line runs through it, and its
   sample bars sit on that line exactly as every row's bars do. */
.tf-key { padding:12px 0 11px; border-bottom:1px solid var(--rule); }
.tf-key-line { position:relative; display:block; height:15px; }
.tf-key-name { position:absolute; left:0; top:0; width:28%; text-align:right; }
.tf-key-bar { top:6px; }
.tf-key-scale { display:block; margin-top:6px; max-width:62ch; }

.tf-row { position:relative; padding:12px 0 11px; border-bottom:1px solid var(--rule); }
.tf-row[data-live="true"] { background: var(--rule); }
.tf-open { display:block; width:100%; text-align:left; }
.tf-sentence { display:block; font-family: var(--font-note); font-weight:300;
  font-size: var(--t-claim); line-height:1.42; color: var(--ink-2); max-width:62ch;
  overflow-wrap:anywhere; }
.tf-open:hover .tf-sentence, .tf-row[data-live="true"] .tf-sentence { color: var(--ink); }

.tf-app { position:relative; display:block; height:8px; margin-top:8px; }
.tf-bar { position:absolute; display:block; height:3px; }
.tf-outer { top:0; }
.tf-inner { top:5px; }
.tf-a { right:50%; background: var(--agrees); }
.tf-c { left:50%; background: var(--contradicts); }

.tf-row-foot { display:flex; align-items:flex-end; gap:14px; margin-top:8px; }
.tf-strip { display:flex; align-items:flex-end; gap:1px; height:11px;
  flex:0 1 auto; min-width:0; overflow:hidden; }
.tf-tick { display:block; flex:0 1 3px; min-width:1px;
  background: var(--memory); cursor:pointer; }
.tf-tick:hover, .tf-tick[data-live="true"] { background: var(--memory-live); }
.tf-counts { display:flex; align-items:baseline; gap:5px; flex:0 0 auto;
  white-space:nowrap; }
.tf-counts .obs-figure { font-size: var(--t-label); }

/* ── passage ───────────────────────────────────────────────────────────── */
.tf-passage { display:flex; flex-direction:column; min-width:0; min-height:0;
  background: var(--margin); }
.tf-root[data-stacked="false"] .tf-passage { border-left:1px solid var(--rule); }
.tf-root[data-stacked="true"] .tf-passage { border-top:1px solid var(--rule); }

.tf-focus { padding:18px 26px 15px; border-bottom:1px solid var(--rule); }
.tf-focus-text { margin:0; font-family: var(--font-note); font-weight:300;
  font-size: var(--t-stat); line-height:1.3; color: var(--ink); max-width:62ch;
  overflow-wrap:anywhere; }
.tf-fields { display:flex; flex-wrap:wrap; gap:8px 22px; margin-top: var(--gap-block); }
.tf-field { display:flex; flex-direction:column; }
.tf-field .obs-figure { font-size: var(--t-body); }
.tf-retention { display:flex; align-items:center; gap:5px; }

.tf-walk { display:flex; align-items:center; flex-wrap:wrap; gap:14px;
  margin-top: var(--gap-block); }
.tf-walk-item { font-size: var(--t-label); font-stretch:78%; font-weight:500;
  color: var(--ink-3); border-bottom:1px solid var(--rule); padding-bottom:1px; }
.tf-walk-item:hover:enabled { color: var(--ink); }
.tf-walk-item:disabled { opacity:0.38; cursor:default; }
.tf-walk-note { color: var(--ink-3); }

.tf-nbs { flex:1 1 auto; min-height:0; overflow-y:auto; padding:14px 26px 48px; }
.tf-nbs-head { margin:0 0 4px; max-width:62ch; }

.tf-nb { display:grid; grid-template-columns:5px minmax(0,1fr) 5px; gap:0 14px;
  width:100%; text-align:left; align-items:stretch; padding:12px 0 11px;
  border-bottom:1px solid var(--rule); }
.tf-nb-rule { display:block; align-self:stretch; }
.tf-nb-left { justify-self:end; }
.tf-nb-right { justify-self:start; }
.tf-nb-body { min-width:0; }
.tf-nb-text { display:block; font-family: var(--font-note); font-weight:300;
  font-size: var(--t-claim); line-height:1.42; color: var(--ink-2); max-width:62ch;
  overflow-wrap:anywhere; }
.tf-nb:hover .tf-nb-text { color: var(--ink); }
.tf-nb-meta { display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 16px;
  margin-top:5px; }
.tf-nb-count { display:flex; align-items:baseline; gap:5px; }
.tf-nb-count .obs-figure { font-size: var(--t-label); }

.tf-empty { padding:26px; }
.tf-empty-lead { margin:0 0 var(--gap-block); font-family: var(--font-note);
  font-weight:200; font-size: var(--t-mast); line-height:1.18; color: var(--ink);
  max-width:24ch; }
.tf-empty-note { margin:0 0 var(--gap-block); font-family: var(--font-note);
  font-weight:300; font-size: var(--t-claim); line-height:1.5; color: var(--ink-2);
  max-width:62ch; }
`;

export const textFirst: DemoModule = {
  id: 'text-first',
  name: 'Read, then trace',
  dimension: 'Hybrid',
  claim:
    'The overview can be the writing itself: group the store by what it actually says and both ' +
    'the reading and its connections fit on one plate — if that fails, no amount of ranking will ' +
    'make text carry a store this size.',
  Plate,
};
