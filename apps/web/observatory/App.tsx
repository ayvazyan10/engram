import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { loadObservatoryData } from './data';
import { DEMOS } from './demos/registry';
import type { ObsData, ObsStats } from './demos/contract';

/**
 * The comparison page.
 *
 * It is deliberately almost nothing: a switch, the denominators, and the
 * visualization. The owner is judging three visualizations, and every pixel
 * that is not one of them competes with them for attention. So there is no
 * masthead, no navigation, no panel, no card, and no framing — the
 * visualization bleeds to three edges of the window, and the only chrome is a
 * single band along the top.
 *
 * The band carries the two things the brief asks for and nothing else: a
 * one-click switch between the three, each named by the idea it tests, and the
 * real denominators with the real totals beside them. The two link hues are
 * introduced by the swatches inside the stamp rather than by a separate key,
 * so the page teaches its own colour language without spending a block on it.
 */

// ─── Reduced motion ─────────────────────────────────────────────────────────

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

// ─── Box measurement ────────────────────────────────────────────────────────

function useBoxSize(): [React.RefObject<HTMLDivElement | null>, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const box = entry.contentRect;
      setSize({ width: Math.round(box.width), height: Math.round(box.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

// ─── The denominator stamp ──────────────────────────────────────────────────

const nf = new Intl.NumberFormat('en-US');

interface CellProps {
  label: string;
  value: number | string;
  note?: string;
  /** A 2px bar of this colour before the figure, when the cell IS the key. */
  swatch?: string;
}

function Cell({ label, value, note, swatch }: CellProps) {
  return (
    <div className="obs-cell">
      <div className="obs-label">{label}</div>
      <div className="obs-cell-value">
        {swatch ? <span className="obs-swatch" style={{ background: swatch }} aria-hidden /> : null}
        <span className="obs-figure" style={{ fontSize: 'var(--t-figure)' }}>
          {typeof value === 'number' ? nf.format(value) : value}
        </span>
      </div>
      {note ? <div className="obs-cell-note">{note}</div> : null}
    </div>
  );
}

function Stamp({ stats }: { stats: ObsStats }) {
  return (
    <div className="obs-stamp">
      <Cell label="Memories" value={stats.memories} note={`${nf.format(stats.isolated)} with no link`} />
      <Cell
        label="Links drawn"
        value={stats.linksDrawn}
        note={`of ${nf.format(stats.linksStored)} stored`}
      />
      <Cell
        label="Not renderable"
        value={stats.linksToArchived}
        note="onto archived memories"
      />
      <Cell label="Agrees" value={stats.agrees} swatch="var(--agrees)" note="relates_to" />
      <Cell
        label="Contradicts"
        value={stats.contradicts}
        swatch="var(--contradicts)"
        note="contradicts"
      />
      <Cell
        label="Projection keeps"
        value={`${Math.round(stats.explainedVariance * 100)}%`}
        note="of embedding variance"
      />
    </div>
  );
}

// ─── The switch ─────────────────────────────────────────────────────────────

function initialDemo(): string {
  const hash = typeof location === 'undefined' ? '' : location.hash.replace('#', '');
  return DEMOS.some((d) => d.id === hash) ? hash : DEMOS[0]!.id;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function App() {
  const reducedMotion = useReducedMotion();
  const [data, setData] = useState<ObsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState(initialDemo);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [plateRef, size] = useBoxSize();

  useEffect(() => {
    let live = true;
    loadObservatoryData().then(
      (loaded) => live && setData(loaded),
      (cause: unknown) => live && setError(cause instanceof Error ? cause.message : String(cause))
    );
    return () => {
      live = false;
    };
  }, []);

  const select = useCallback((id: string | null) => setSelectedId(id), []);

  const choose = useCallback((id: string) => {
    setActiveId(id);
    history.replaceState(null, '', `#${id}`);
  }, []);

  // 1 … 9 switch demos. The switch is one click; this makes it one key.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // A demo may own a text field — the text-first census has a filter box.
      // Without this guard, typing a year or a model number into it navigates
      // away mid-word, because every digit is also a demo shortcut.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      const index = Number(event.key) - 1;
      const demo = DEMOS[index];
      if (demo) choose(demo.id);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [choose]);

  const active = DEMOS.find((d) => d.id === activeId) ?? DEMOS[0]!;
  const Plate = active.Plate;

  return (
    <div className="obs-page">
      <header className="obs-band">
        <div className="obs-band-top">
          <div className="obs-switch" role="group" aria-label="Visualization">
            {DEMOS.map((demo) => (
              <button
                key={demo.id}
                type="button"
                className="obs-switch-item"
                aria-pressed={demo.id === active.id}
                onClick={() => choose(demo.id)}
              >
                <span className="obs-switch-name">{demo.name}</span>
                <span className="obs-label obs-switch-dim">{demo.dimension}</span>
              </button>
            ))}
          </div>
          {data ? <Stamp stats={data.stats} /> : null}
        </div>
        <p className="obs-note obs-claim">{active.claim}</p>
      </header>

      <main className="obs-plate" ref={plateRef}>
        {error ? (
          <p className="obs-message">
            The API on 4901 did not answer: {error}. Nothing is drawn from invented data, so the
            page stops here.
          </p>
        ) : !data ? (
          <p className="obs-message">Reading the store from 4901.</p>
        ) : size.width > 0 && size.height > 0 ? (
          <Plate
            data={data}
            width={size.width}
            height={size.height}
            reducedMotion={reducedMotion}
            selectedId={selectedId}
            onSelect={select}
          />
        ) : null}
      </main>
    </div>
  );
}
