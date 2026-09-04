import { useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
  BarChart, Bar,
} from 'recharts';
import { useAnalyticsStore } from '../../store/analyticsStore.js';
import { useTemplateStore, type UITemplate } from '../../store/templateStore.js';
import { api } from '../../lib/api.js';
import { RADIUS, SPACE, STATUS, TYPE, TYPE_COLORS, withAlpha } from '../../lib/tokens.js';
import { toPlainText } from '../../lib/plainText.js';

/** How many sources the bar chart plots. The panel says so out loud now
 *  (M2) instead of silently dropping the other seven. */
const SOURCE_CHART_LIMIT = 8;

/** H5: the Y axis was 80px wide, so recharts clipped every label from the
 *  LEFT — 'autopilot-learning' rendered as 'utopilot-learning' and
 *  'claude-code-file-memory' as 'de-file-memory', which are not truncations,
 *  they are different words. Real source names reach 26 characters; 140px
 *  holds ~26 at fontSize 10. */
export const SOURCE_AXIS_WIDTH = 140;
export const SOURCE_LABEL_MAX = 24;

const HEATMAP_CELL = 16;
const HEATMAP_GAP = 2;
const HEATMAP_DAY_LABEL = 28;
/** Hour ticks: enough to orient, few enough not to collide at 9px. */
const HEATMAP_HOUR_TICKS = [0, 6, 12, 18];
const HEATMAP_MIN_ALPHA = 0.15;
const HEATMAP_ALPHA_RANGE = 0.85;
const HEATMAP_KEY_STEPS = [0, 0.25, 0.5, 0.75, 1];

interface Props {
  /** The app-level memory load state AppLayout threads to every view. This
   *  view owns its own analytics request, so these only stand in when it has
   *  nothing of its own to say — an auth failure fails both, and reporting it
   *  once here beats reporting nothing. */
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export default function AnalyticsView({ loading: appLoading, error: appError, onRetry }: Props) {
  const { data, loading, days, error, setData, setLoading, setError } = useAnalyticsStore();
  const t = useTemplateStore((s) => s.activeTemplate);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.getAnalytics(days)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      // Without this, loading stayed true forever after a successful load.
      .finally(() => setLoading(false));
  }, [days, setData, setLoading, setError]);

  if ((loading || appLoading) && !data) {
    return (
      <div style={{ ...s.center, color: t.textMuted }}>Loading analytics…</div>
    );
  }

  // A failed request used to be indistinguishable from an empty dataset.
  const failure = error ?? appError ?? null;
  if (failure && !data) {
    return (
      <div style={{ ...s.center, flexDirection: 'column', gap: SPACE.md, color: STATUS.danger }}>
        <div>Could not load analytics: {failure}</div>
        <button
          className="ec-hover-tint"
          style={{
            background: 'transparent',
            border: `1px solid ${STATUS.danger}`,
            color: STATUS.danger,
            borderRadius: RADIUS.sm,
            padding: `${SPACE.xs} ${SPACE.lg}`,
            fontSize: TYPE.base,
            fontFamily: 'inherit',
          }}
          onClick={() => {
            onRetry?.();
            setLoading(true);
            setError(null);
            api.getAnalytics(days)
              .then(setData)
              .catch((e: Error) => setError(e.message))
              .finally(() => setLoading(false));
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ ...s.center, color: t.textMuted }}>No analytics data available.</div>
    );
  }

  const typeData = Object.entries(data.byType).map(([name, value]) => ({ name, value }));
  const allSources = Object.entries(data.bySource).sort((a, b) => b[1] - a[1]);
  const sourceData = allSources.slice(0, SOURCE_CHART_LIMIT).map(([name, value]) => ({ name, value }));

  return (
    <div style={{ ...s.root, background: t.rootBg }}>
      {/* Stats row. M1: the fourth tile read `data.topConcepts.length`, which
          is the API's page size and is therefore always 20 — a made-up
          number sitting beside three real ones with equal authority. There
          is no concept count on any endpoint, so the tile is gone rather
          than wrong. */}
      <div style={s.statsRow}>
        <StatCard label="Total Memories" value={data.total} color={t.accent} t={t} />
        <StatCard label="Avg Importance" value={`${(data.avgImportance * 100).toFixed(0)}%`} color={t.textPrimary} t={t} />
        <StatCard label="Sources" value={allSources.length} color={t.textPrimary} t={t} />
      </div>

      {/* Growth chart */}
      <div style={{ ...s.panel, background: t.cardBg, borderColor: t.panelBorder }}>
        <h3 style={{ ...s.panelTitle, color: t.textPrimary }}>Memory Growth</h3>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data.dailyGrowth}>
            <defs>
              <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={t.accent} stopOpacity={0.3} />
                <stop offset="100%" stopColor={t.accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tick={{ fill: t.textMuted, fontSize: 10 }}
              axisLine={{ stroke: t.panelBorder }}
              tickLine={false}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis
              tick={{ fill: t.textMuted, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={30}
            />
            <Tooltip
              contentStyle={{ background: t.panelBg, border: `1px solid ${t.panelBorder}`, borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: t.textSecondary }}
              itemStyle={{ color: t.textPrimary }}
            />
            <Area type="monotone" dataKey="count" stroke={t.accent} fill="url(#growthGrad)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div style={s.row}>
        {/* Type distribution */}
        <div style={{ ...s.panel, background: t.cardBg, borderColor: t.panelBorder }}>
          <h3 style={{ ...s.panelTitle, color: t.textPrimary }}>By Type</h3>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={typeData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value" paddingAngle={3}>
                {typeData.map((entry) => (
                  <Cell key={entry.name} fill={TYPE_COLORS[entry.name as keyof typeof TYPE_COLORS] ?? '#64748b'} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: t.panelBg, border: `1px solid ${t.panelBorder}`, borderRadius: 8, fontSize: 12 }}
                itemStyle={{ color: t.textPrimary }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div style={s.legend}>
            {typeData.map((d) => (
              <div key={d.name} style={s.legendItem}>
                <span style={{ ...s.legendDot, background: TYPE_COLORS[d.name as keyof typeof TYPE_COLORS] ?? '#64748b' }} />
                <span className="ec-tabular" style={{ color: t.textSecondary, fontSize: TYPE.sm }}>{d.name}: {d.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Source distribution. M2: was titled "By Source" above a chart
            plotting 8 of the 15 the tile beside it counted, with no
            qualifier saying so. */}
        <div style={{ ...s.panel, background: t.cardBg, borderColor: t.panelBorder }}>
          <div style={s.panelHead}>
            <h3 style={{ ...s.panelTitle, color: t.textPrimary }}>Top Sources</h3>
            <span className="ec-tabular" style={{ ...s.panelCaption, color: t.textMuted }}>
              {sourceData.length} of {allSources.length}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={sourceData} layout="vertical">
              <XAxis type="number" tick={{ fill: t.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fill: t.textSecondary, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={SOURCE_AXIS_WIDTH}
                tickFormatter={truncateSourceLabel}
              />
              <Tooltip
                contentStyle={{ background: t.panelBg, border: `1px solid ${t.panelBorder}`, borderRadius: 8, fontSize: 12 }}
                itemStyle={{ color: t.textPrimary }}
              />
              <Bar dataKey="value" fill={t.accent} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top concepts */}
      <div style={{ ...s.panel, background: t.cardBg, borderColor: t.panelBorder }}>
        <h3 style={{ ...s.panelTitle, color: t.textPrimary }}>Top Concepts</h3>
        {/* M10: was a ragged flex wrap of chips 100-300px wide whose last row
            left 445px dead, with no truncation. A grid gives one column
            rhythm; the full value stays on `title`. H4 strips the Markdown
            these concepts arrive wrapped in. */}
        <div style={s.conceptGrid}>
          {data.topConcepts.map((c) => {
            const label = toPlainText(c.concept);
            return (
              <div key={c.concept} title={label} style={{ ...s.conceptChip, background: t.inputBg, borderColor: t.panelBorder }}>
                <span style={{ ...s.conceptName, color: t.textPrimary }}>{label}</span>
                <span className="ec-tabular" style={{ color: t.textMuted, fontSize: TYPE.xs }}>{c.count} memories</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Activity heatmap */}
      <div style={{ ...s.panel, background: t.cardBg, borderColor: t.panelBorder }}>
        <h3 style={{ ...s.panelTitle, color: t.textPrimary }}>Activity Heatmap</h3>
        <ActivityHeatmap data={data.hourlyActivity} />
      </div>
    </div>
  );
}

/** Truncate at the END, with an ellipsis, so the label still starts on the
 *  word the source is actually called (H5). */
export function truncateSourceLabel(value: string): string {
  return value.length > SOURCE_LABEL_MAX ? `${value.slice(0, SOURCE_LABEL_MAX - 1)}…` : value;
}

function StatCard({ label, value, color, t }: { label: string; value: string | number; color: string; t: UITemplate }) {
  return (
    <div style={{ ...s.statCard, background: t.cardBg, borderColor: t.panelBorder }}>
      <div className="ec-tabular" style={{ fontSize: TYPE.display, fontWeight: 700, color, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: TYPE.sm, color: t.textMuted, marginTop: SPACE['2xs'] }}>{label}</div>
    </div>
  );
}

function ActivityHeatmap({ data }: { data: Array<{ hour: number; dayOfWeek: number; count: number }> }) {
  const t = useTemplateStore((s) => s.activeTemplate);
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const grid = Array.from({ length: 7 }, (_, dow) =>
    Array.from({ length: 24 }, (_, h) => {
      const cell = data.find((d) => d.dayOfWeek === dow && d.hour === h);
      return cell?.count ?? 0;
    })
  );

  // M3: was a hardcoded rgba(99,102,241,…) — Neural's accent — so the one
  // surface the theme switcher provably did not reach stayed indigo in Mono
  // and Midnight.
  const cellColor = (intensity: number) => withAlpha(t.accent, HEATMAP_MIN_ALPHA + intensity * HEATMAP_ALPHA_RANGE);

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: `${HEATMAP_GAP}px`, minWidth: '500px' }}>
        {grid.map((row, dow) => (
          <div key={dow} style={{ display: 'flex', alignItems: 'center', gap: `${HEATMAP_GAP}px` }}>
            <span style={{ width: `${HEATMAP_DAY_LABEL}px`, fontSize: TYPE.micro, color: t.textMuted, flexShrink: 0 }}>{days[dow]}</span>
            {row.map((count, h) => (
              <div
                key={h}
                title={`${days[dow]} ${h}:00 — ${count} memories`}
                style={{
                  width: `${HEATMAP_CELL}px`,
                  height: `${HEATMAP_CELL}px`,
                  borderRadius: RADIUS.tight,
                  flexShrink: 0,
                  background: count === 0 ? t.inputBg : cellColor(count / maxCount),
                }}
              />
            ))}
          </div>
        ))}

        {/* M4: the grid's only affordance was a `title`, which does not exist
            on touch — there was no hour axis and no way to read an intensity.
            The ticks sit on the same 18px cell pitch as the grid above. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: `${HEATMAP_GAP}px`, marginTop: SPACE['3xs'] }}>
          <span style={{ width: `${HEATMAP_DAY_LABEL}px`, flexShrink: 0 }} />
          {Array.from({ length: 24 }, (_, h) => (
            <span
              key={h}
              className="ec-tabular"
              style={{ width: `${HEATMAP_CELL}px`, flexShrink: 0, fontSize: TYPE.micro, color: t.textMuted, textAlign: 'center' as const }}
            >
              {HEATMAP_HOUR_TICKS.includes(h) ? h : ''}
            </span>
          ))}
        </div>

        <div style={s.heatmapKey}>
          <span style={{ fontSize: TYPE.micro, color: t.textMuted }}>Less</span>
          {HEATMAP_KEY_STEPS.map((step) => (
            <span
              key={step}
              style={{
                width: `${HEATMAP_CELL - 4}px`,
                height: `${HEATMAP_CELL - 4}px`,
                borderRadius: RADIUS.tight,
                background: step === 0 ? t.inputBg : cellColor(step),
              }}
            />
          ))}
          <span style={{ fontSize: TYPE.micro, color: t.textMuted }}>More</span>
        </div>
      </div>
    </div>
  );
}

// M7: this file imported TYPE_COLORS and STATUS from lib/tokens.ts and never
// TYPE, SPACE or RADIUS — every size and space below was a raw literal, with
// radius 12px and font sizes written as strings. Substituted to the nearest
// scale step.
const s = {
  root: {
    flex: 1,
    overflow: 'auto',
    // clamp() rather than a fixed breakpoint — V3: 320px needs ~16px of
    // breathing room, 1920px can afford the original 36px, and everything
    // between scales instead of jumping.
    padding: 'clamp(16px, 4vw, 28px) clamp(16px, 5vw, 36px)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: SPACE.xl,
  },
  center: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: TYPE.lg,
  },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: SPACE.md,
  },
  statCard: {
    border: '1px solid',
    borderRadius: RADIUS.lg,
    padding: `${SPACE.xl} ${SPACE.xl}`,
  },
  panel: {
    border: '1px solid',
    borderRadius: RADIUS.lg,
    padding: SPACE.xl,
    minWidth: 0,
  },
  panelHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: SPACE.sm,
  },
  panelTitle: {
    fontSize: TYPE.md,
    fontWeight: 600,
    margin: `0 0 ${SPACE.lg} 0`,
  },
  panelCaption: {
    fontSize: TYPE.sm,
  },
  row: {
    display: 'grid',
    // auto-fit + minmax rather than a fixed '1fr 1fr' — the two chart
    // panels stack to a single column on their own once the viewport can't
    // give each at least 260px, instead of squeezing a pie chart into ~140px
    // at 320-375px (V3).
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: SPACE.lg,
  },
  legend: {
    display: 'flex',
    gap: SPACE.md,
    justifyContent: 'center',
    marginTop: SPACE.sm,
    flexWrap: 'wrap' as const,
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE['2xs'],
  },
  legendDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    display: 'inline-block',
  },
  conceptGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: SPACE.sm,
  },
  conceptChip: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: SPACE['3xs'],
    padding: `${SPACE.sm} ${SPACE.md}`,
    borderRadius: RADIUS.md,
    border: '1px solid',
    minWidth: 0,
  },
  conceptName: {
    fontSize: TYPE.base,
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  heatmapKey: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: SPACE['2xs'],
    marginTop: SPACE.sm,
  },
} as const;
