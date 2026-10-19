import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { HourlyActivity } from '../../store/analyticsStore.js';
import { DAY_NAMES } from './format.js';

/**
 * Memories per hour of the week, on a validated one-hue ordinal ramp
 * (`--heat-1…4` in tokens.css). Colour carries the coarse level and the cell
 * carries the number, since no ramp resolves 1 against 2. The day axis sits
 * outside the scroller, every cell is reachable by arrow keys, and the
 * read-out below the grid says what a tooltip would.
 */

const HOURS = 24;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const HOUR_TICKS = [0, 6, 12, 18];
/** Steps in the ramp (`--heat-1` to `--heat-4`). */
export const RAMP_STEPS = 4;
/** The longest count that fits inside a cell without clipping. */
const MAX_INLINE_DIGITS = 2;

export interface HeatCell {
  dow: number;
  hour: number;
  count: number;
}

/**
 * Which ramp step (0-based) a count takes, over [1, max]; -1 for an empty hour,
 * which is drawn as an empty slot. `ceil`, so the busiest hour always lands
 * on the top step.
 */
export function bucketIndex(count: number, max: number): number {
  if (count <= 0) return -1;
  if (max <= 0) return RAMP_STEPS - 1;
  return Math.min(RAMP_STEPS - 1, Math.ceil((count * RAMP_STEPS) / max) - 1);
}

/** The count range each step actually covers, for the key. */
export function bucketRanges(max: number): Array<{ step: number; lo: number; hi: number }> {
  const out: Array<{ step: number; lo: number; hi: number }> = [];
  for (let count = 1; count <= Math.max(1, max); count++) {
    const step = bucketIndex(count, max);
    const last = out[out.length - 1];
    if (last && last.step === step) last.hi = count;
    else out.push({ step, lo: count, hi: count });
  }
  return out;
}

const KEY_DELTA: Record<string, readonly [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
const cellLabel = (c: HeatCell) => `${DAY_NAMES[c.dow]} ${hourLabel(c.hour)}, ${c.count} ${c.count === 1 ? 'memory' : 'memories'}`;

function buildGrid(data: readonly HourlyActivity[]): { grid: number[][]; max: number; busiest: HeatCell } {
  const grid = Array.from({ length: DAYS.length }, () => Array.from({ length: HOURS }, () => 0));
  let busiest: HeatCell = { dow: 0, hour: 0, count: 0 };
  for (const cell of data) {
    const row = grid[cell.dayOfWeek];
    if (!row || cell.hour < 0 || cell.hour >= HOURS) continue;
    row[cell.hour] = cell.count;
    if (cell.count > busiest.count) busiest = { dow: cell.dayOfWeek, hour: cell.hour, count: cell.count };
  }
  return { grid, max: busiest.count, busiest };
}

export default function ActivityHeatmap({ data }: { data: readonly HourlyActivity[] }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const movedByKey = useRef(false);
  const [active, setActive] = useState(0);
  const [reading, setReading] = useState<HeatCell | null>(null);
  const { grid, max, busiest } = useMemo(() => buildGrid(data), [data]);

  useEffect(() => {
    if (!movedByKey.current) return;
    movedByKey.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${active}"]`)?.focus();
  }, [active]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = KEY_DELTA[event.key];
    if (!delta) return;
    event.preventDefault();
    movedByKey.current = true;
    setActive(clamp(Math.floor(active / HOURS) + delta[0], DAYS.length - 1) * HOURS + clamp((active % HOURS) + delta[1], HOURS - 1));
  };

  const shown = reading ?? busiest;

  return (
    <div className="in-heat">
      <div className="in-heat-frame">
        <div className="in-heat-days" aria-hidden="true">
          {DAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="in-heat-scroll">
          <div ref={gridRef} role="grid" aria-label="Memories stored, by day of week and hour" onKeyDown={onKeyDown} className="in-heat-grid">
            {grid.map((row, dow) => (
              <div key={dow} role="row">
                {row.map((count, hour) => {
                  const index = dow * HOURS + hour;
                  const step = bucketIndex(count, max);
                  const cell = { dow, hour, count };
                  return (
                    <div
                      key={hour}
                      role="gridcell"
                      data-cell={index}
                      data-step={step + 1}
                      tabIndex={index === active ? 0 : -1}
                      aria-label={cellLabel(cell)}
                      title={cellLabel(cell)}
                      onMouseEnter={() => setReading(cell)}
                      onMouseLeave={() => setReading(null)}
                      onFocus={() => {
                        setActive(index);
                        setReading(cell);
                      }}
                      onBlur={() => setReading(null)}
                    >
                      {count > 0 && String(count).length <= MAX_INLINE_DIGITS ? count : ''}
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="in-heat-ticks" aria-hidden="true">
              {Array.from({ length: HOURS }, (_, h) => (
                <span key={h}>{HOUR_TICKS.includes(h) ? `${String(h).padStart(2, '0')}:00` : ''}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="in-heat-foot">
        <p aria-live="polite">
          {reading ? '' : 'Busiest: '}
          {DAY_NAMES[shown.dow]} {hourLabel(shown.hour)}, <b>{shown.count}</b> {shown.count === 1 ? 'memory' : 'memories'}
        </p>
        <div className="in-heat-key">
          <span>Memories per hour</span>
          <span>
            <i data-step="0" />0
          </span>
          {bucketRanges(max).map(({ step, lo, hi }) => (
            <span key={step}>
              <i data-step={step + 1} />
              {lo === hi ? lo : `${lo}–${hi}`}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
