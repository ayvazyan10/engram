import { useMemo } from 'react';
import { Icon } from '../../shell/icons.js';
import { TypeMark } from '../memory/MemoryRow.js';
import { dayCounts, LENSES, type Lens } from './lenses.js';

/** The lens switch: three pressed-or-not buttons, word and icon. */
export function LensBar({ lens, onLens }: { lens: Lens; onLens: (lens: Lens) => void }) {
  return (
    <div className="mp-lens" role="group" aria-label="Lens">
      {LENSES.map((l) => (
        <button key={l.lens} type="button" aria-pressed={lens === l.lens} title={l.hint} onClick={() => onLens(l.lens)}>
          <Icon name={l.icon} size={16} />
          <span>{l.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Zoom in, out, and back to the whole map. The keys are +, - and 0. */
export function ZoomControls({ onZoom, onFit }: { onZoom: (factor: number) => void; onFit: () => void }) {
  return (
    <div className="mp-zoom" role="group" aria-label="Zoom">
      <button type="button" aria-label="Zoom in" aria-keyshortcuts="+" onClick={() => onZoom(1.5)}>
        +
      </button>
      <button type="button" aria-label="Zoom out" aria-keyshortcuts="-" onClick={() => onZoom(1 / 1.5)}>
        −
      </button>
      <button type="button" aria-label="Fit the whole map" aria-keyshortcuts="0" onClick={onFit}>
        <Icon name="compass" size={18} />
      </button>
    </div>
  );
}

/**
 * What the marks mean: type is a shape as well as a colour, hollow is a
 * reflection, the stud is protected, and how far to trust a distance. The
 * Faults lens adds the line and how many are drawn.
 */
export function Legend({ note, faults }: { note: string; faults: string | null }) {
  return (
    <div className="mp-legend">
      <ul aria-label="Legend">
        <li>
          <TypeMark type="semantic" size={12} />
          Semantic
        </li>
        <li>
          <TypeMark type="episodic" size={12} />
          Episodic
        </li>
        <li>
          <TypeMark type="procedural" size={12} />
          Procedural
        </li>
        <li>
          <TypeMark type="semantic" hollow size={12} />
          Reflection
        </li>
        {faults !== null && (
          <li>
            <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true" className="mp-fault-mark">
              <path d="M1 9c5-1 6-6 10-6s6 4 10 2" />
            </svg>
            Contradiction
          </li>
        )}
      </ul>
      <p>{faults ?? `${note} Size is importance; faded marks are fading from memory, a dot marks a protected one.`}</p>
    </div>
  );
}

/** At most this many bars; a longer span groups days into each. */
const MAX_BARS = 120;

/**
 * The Time lens's scrubber: memories stored per day as bars (today on the
 * right), and a slider for how many days back to show. Older memories fade
 * to a trace on the map.
 */
export function TimeScrubber({
  created,
  now,
  span,
  cut,
  onCut,
}: {
  created: ArrayLike<number>;
  now: number;
  span: number;
  cut: number;
  onCut: (days: number) => void;
}) {
  const per = Math.max(1, Math.ceil(span / MAX_BARS));
  const bars = useMemo(() => {
    const days = dayCounts(created, now, span);
    const out: number[] = [];
    for (let i = 0; i < days.length; i += per) out.push(days.slice(i, i + per).reduce((a, b) => a + b, 0));
    return out;
  }, [created, now, span, per]);
  const top = Math.max(1, ...bars);
  const shown = dayCounts(created, now, Math.min(span, cut)).reduce((a, b) => a + b, 0);
  const w = 100 / bars.length;
  return (
    <div className="mp-scrub">
      <svg viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true">
        {bars.map((n, i) =>
          n > 0 ? (
            <rect
              key={i}
              x={100 - (i + 1) * w + w * 0.12}
              width={w * 0.76}
              y={26 - Math.max(2, 24 * Math.sqrt(n / top))}
              height={Math.max(2, 24 * Math.sqrt(n / top))}
              data-in={i * per < cut}
            />
          ) : null
        )}
      </svg>
      <input
        type="range"
        min={1}
        max={span}
        value={Math.min(cut, span)}
        onChange={(e) => onCut(Number(e.target.value))}
        aria-label="Show memories up to this many days old"
        aria-valuetext={`${cut} ${cut === 1 ? 'day' : 'days'}, ${shown} memories`}
      />
      <div className="mp-scrub-l">
        <span>{span} days ago</span>
        <span>
          <b>{shown.toLocaleString('en-US')}</b> {shown === 1 ? 'memory' : 'memories'} from the last <b>{cut}</b> {cut === 1 ? 'day' : 'days'}
        </span>
        <span>Today</span>
      </div>
    </div>
  );
}
