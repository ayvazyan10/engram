import { useEffect, useMemo, useRef, useState } from 'react';
import { useTemplateStore } from '../../../store/templateStore.js';
import type { HourlyActivity } from '../../../store/analyticsStore.js';
import { ACTIVITY_RAMP, RADIUS, SPACE, TYPE, WEIGHT } from '../../../lib/tokens.js';

/**
 * Memories per hour of the week — a real sequential scale (F4).
 *
 * What was here: `withAlpha(t.accent, 0.15 + intensity * 0.85)`, an opacity
 * ramp over whichever accent the active template supplied. Composited on the
 * card it put count 0 at 1.05:1 and count 1 at 1.41:1 — invisible — and Mono
 * passed only because its accent happens to be white, so legibility was an
 * accident of which template was on. `ACTIVITY_RAMP` (lib/tokens.ts) is a
 * validated one-hue ramp; see that file for the `--ordinal` results.
 *
 * Colour alone still cannot do this data's job. The live store's busiest hour
 * holds six memories and 38 of the 49 non-empty cells hold one or two — no
 * ramp resolves 1-vs-2 at that range. So colour carries the coarse level and
 * the cell carries the number, which is what a 16px cell is for.
 *
 * Three access defects went with it: the day labels lived INSIDE the horizontal
 * scroller, so scrolling right removed the Sun–Sat axis entirely; none of the
 * 168 cells was focusable, so the `title` was unreachable by keyboard and
 * absent on touch; and the key said "Less … More" without ever stating that the
 * maximum is six.
 */

const CELL = 16;
const GAP = 2;
const DAY_LABEL_WIDTH = 28;
const HOURS = 24;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
/** Hour ticks: enough to orient, few enough not to collide at 9px. */
const HOUR_TICKS = [0, 6, 12, 18];

/**
 * Ink for a number set inside a coloured fill — the one case where text may sit
 * on a data colour, and only when it is picked by the fill's luminance. White
 * clears 7.37:1 and 5.11:1 on the two dark steps; the near-black clears 5.42:1
 * and 7.77:1 on the two light ones.
 */
const CELL_INK = ['#ffffff', '#ffffff', '#1b0716', '#1b0716'] as const;

/** Longest count that fits inside a 16px cell at 9px without clipping. */
const MAX_INLINE_DIGITS = 2;

export interface HeatCell {
  dow: number;
  hour: number;
  count: number;
}

/**
 * Which ramp step a count takes. Fixed number of steps over [1, max], so the
 * key can state the real range instead of an unlabelled gradient. Zero is not a
 * step: an empty hour is drawn as an empty slot, not as a faint mark.
 *
 * `ceil` rather than `floor` so the busiest hour always lands on the TOP step
 * whatever the maximum is — a store whose busiest hour holds one memory should
 * not draw that hour in the ramp's dimmest step.
 */
export function bucketIndex(count: number, max: number): number {
  if (count <= 0) return -1;
  if (max <= 0) return ACTIVITY_RAMP.length - 1;
  return Math.min(ACTIVITY_RAMP.length - 1, Math.ceil((count * ACTIVITY_RAMP.length) / max) - 1);
}

/** The count range each ramp step actually covers, for the key. */
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

/** Arrow-key movement across the grid, as [dow, hour] deltas. */
const KEY_DELTA: Record<string, readonly [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

export default function ActivityHeatmap({ data }: { data: readonly HourlyActivity[] }) {
  const t = useTemplateStore((s) => s.activeTemplate);
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

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const delta = KEY_DELTA[event.key];
    if (!delta) return;
    event.preventDefault();
    const next = clamp(Math.floor(active / HOURS) + delta[0], DAYS.length - 1) * HOURS
      + clamp((active % HOURS) + delta[1], HOURS - 1);
    movedByKey.current = true;
    setActive(next);
  }

  const shown = reading ?? busiest;

  return (
    <div>
      <div style={s.frame}>
        {/* Day axis OUTSIDE the scroller — it used to scroll away with the
            grid, so at 375px scrolling right left seven unlabelled rows. */}
        <div style={s.dayColumn} aria-hidden="true">
          {DAYS.map((day) => (
            <span key={day} style={{ ...s.dayLabel, color: t.textMuted }}>{day}</span>
          ))}
        </div>

        <div style={s.scroller}>
          <div
            ref={gridRef}
            role="grid"
            aria-label="Memories stored, by day of week and hour"
            onKeyDown={onKeyDown}
            style={s.grid}
          >
            {grid.map((row, dow) => (
              <div key={dow} role="row" style={s.row}>
                {row.map((count, hour) => {
                  const index = dow * HOURS + hour;
                  const step = bucketIndex(count, max);
                  return (
                    <Cell
                      key={hour}
                      index={index}
                      dow={dow}
                      hour={hour}
                      count={count}
                      step={step}
                      tabbable={index === active}
                      emptyBorder={t.panelBorder}
                      onRead={setReading}
                      onActivate={setActive}
                    />
                  );
                })}
              </div>
            ))}

            <div style={s.tickRow} aria-hidden="true">
              {Array.from({ length: HOURS }, (_, h) => (
                <span
                  key={h}
                  className="ec-tabular"
                  style={{ ...s.tick, color: t.textMuted }}
                >
                  {HOUR_TICKS.includes(h) ? h : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* The read-out a tooltip used to gate. Updates on hover AND on focus,
          and defaults to the busiest hour so the panel says something true
          before anything is pointed at. */}
      <p aria-live="polite" style={{ ...s.readout, color: t.textSecondary }}>
        {reading ? '' : 'Busiest: '}
        {DAY_NAMES[shown.dow]} {hourLabel(shown.hour)} — <strong style={{ fontWeight: WEIGHT.semibold }}>{shown.count}</strong>
        {shown.count === 1 ? ' memory' : ' memories'}
      </p>

      <ScaleKey max={max} muted={t.textMuted} emptyBorder={t.panelBorder} />
    </div>
  );
}

function Cell({
  index, dow, hour, count, step, tabbable, emptyBorder, onRead, onActivate,
}: {
  index: number; dow: number; hour: number; count: number; step: number;
  tabbable: boolean; emptyBorder: string;
  onRead: (cell: HeatCell | null) => void;
  onActivate: (index: number) => void;
}) {
  const label = `${DAY_NAMES[dow]} ${hourLabel(hour)} — ${count} ${count === 1 ? 'memory' : 'memories'}`;
  const filled = step >= 0;
  const inline = count > 0 && String(count).length <= MAX_INLINE_DIGITS ? String(count) : '';
  return (
    <div
      role="gridcell"
      data-cell={index}
      tabIndex={tabbable ? 0 : -1}
      aria-label={label}
      title={label}
      className="ec-cell"
      onMouseEnter={() => onRead({ dow, hour, count })}
      onMouseLeave={() => onRead(null)}
      onFocus={() => { onActivate(index); onRead({ dow, hour, count }); }}
      onBlur={() => onRead(null)}
      style={{
        ...s.cell,
        background: filled ? ACTIVITY_RAMP[step] : 'transparent',
        boxShadow: filled ? 'none' : `inset 0 0 0 1px ${emptyBorder}`,
        color: filled ? CELL_INK[step] : 'transparent',
      }}
    >
      {inline}
    </div>
  );
}

/** The key states the real counts. It used to read "Less ▪▪▪▪ More", from
 *  which a reader could not learn that the maximum is six. */
function ScaleKey({ max, muted, emptyBorder }: { max: number; muted: string; emptyBorder: string }) {
  return (
    <div style={s.key}>
      <span style={{ ...s.keyLabel, color: muted }}>Memories per hour</span>
      <span style={s.keyItem}>
        <span style={{ ...s.keySwatch, boxShadow: `inset 0 0 0 1px ${emptyBorder}` }} />
        <span className="ec-tabular" style={{ ...s.keyText, color: muted }}>0</span>
      </span>
      {bucketRanges(max).map(({ step, lo, hi }) => (
        <span key={step} style={s.keyItem}>
          <span style={{ ...s.keySwatch, background: ACTIVITY_RAMP[step] }} />
          <span className="ec-tabular" style={{ ...s.keyText, color: muted }}>
            {lo === hi ? lo : `${lo}–${hi}`}
          </span>
        </span>
      ))}
    </div>
  );
}

function buildGrid(data: readonly HourlyActivity[]): {
  grid: number[][];
  max: number;
  busiest: HeatCell;
} {
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

const s = {
  frame: { display: 'flex', alignItems: 'flex-start', gap: `${GAP}px` },
  dayColumn: { display: 'flex', flexDirection: 'column' as const, gap: `${GAP}px`, flexShrink: 0 },
  dayLabel: {
    width: `${DAY_LABEL_WIDTH}px`,
    height: `${CELL}px`,
    display: 'flex',
    alignItems: 'center',
    fontSize: TYPE.micro,
  },
  scroller: { overflowX: 'auto' as const, flex: 1, minWidth: 0 },
  grid: { display: 'flex', flexDirection: 'column' as const, gap: `${GAP}px`, width: 'max-content' },
  row: { display: 'flex', gap: `${GAP}px` },
  cell: {
    width: `${CELL}px`,
    height: `${CELL}px`,
    borderRadius: RADIUS.tight,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: TYPE.micro,
    fontVariantNumeric: 'tabular-nums' as const,
    lineHeight: 1,
  },
  tickRow: { display: 'flex', gap: `${GAP}px`, marginTop: SPACE['3xs'] },
  tick: { width: `${CELL}px`, flexShrink: 0, fontSize: TYPE.micro, textAlign: 'center' as const },
  readout: { margin: `${SPACE.sm} 0 0`, fontSize: TYPE.sm },
  key: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    gap: `${GAP}px ${SPACE.sm}`,
    marginTop: SPACE.sm,
  },
  keyLabel: { fontSize: TYPE.micro, marginRight: SPACE['2xs'] },
  keyItem: { display: 'inline-flex', alignItems: 'center', gap: SPACE['3xs'] },
  keySwatch: { width: '12px', height: '12px', borderRadius: RADIUS.tight, display: 'inline-block' },
  keyText: { fontSize: TYPE.micro },
} as const;
