import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
  BarChart, Bar, LabelList,
} from 'recharts';
import { useTemplateStore, type UITemplate } from '../../../store/templateStore.js';
import type { AnalyticsData, WindowedAnalytics } from '../../../store/analyticsStore.js';
import { RADIUS, SERIES, SPACE, TYPE } from '../../../lib/tokens.js';
import { toPlainText } from '../../../lib/plainText.js';
import { DataDot } from '../../ui/DataMark.js';
import ChartPanel from './ChartPanel.js';
import ActivityHeatmap from './ActivityHeatmap.js';
import {
  ACTIVE_BAR_FILL, BAR_SIZE, DAY_NAMES, SOURCE_AXIS_WIDTH, SOURCE_CHART_LIMIT,
  describeCoverage, percent, truncateSourceLabel, typeFill, typeLabel,
} from './format.js';

/**
 * One panel per component, so `AnalyticsView` reads as the page's structure
 * rather than as 300 lines of chart configuration.
 *
 * Everything here is windowed. The view prints the window once, above all of
 * it — the payload used to mix scopes silently (`byType` and `bySource` were
 * windowed and summed to 87, beside a `total` of 651) and the fix is that a
 * reader can see which question each number answers.
 */

/**
 * The KPI row. M1: the fourth tile used to read `topConcepts.length`, which is
 * the API's page size and therefore always 20 — a made-up number sitting beside
 * three real ones with equal authority. The server reports a genuine
 * `conceptCount` now, so the tile is back with the real statistic rather than
 * deleted. Each `sub` names the all-time denominator.
 */
export function StatsRow({ data }: { data: AnalyticsData }) {
  const t = useTemplateStore((s) => s.activeTemplate);
  const w = data.windowed;
  return (
    <div style={s.statsRow}>
      <StatCard label="Memories" value={w.total} sub={`of ${data.allTime.total} stored`} t={t} />
      <StatCard
        label="Avg importance"
        value={percent(w.avgImportance)}
        sub={`all-time ${percent(data.allTime.avgImportance)}`}
        t={t}
      />
      <StatCard label="Sources" value={w.sourceCount} sub={`of ${data.allTime.sourceCount} all-time`} t={t} />
      <StatCard label="Concepts" value={w.conceptCount} sub={`of ${data.allTime.conceptCount} all-time`} t={t} />
    </div>
  );
}

/**
 * F7: the 24px figure carried `ec-tabular`. Tabular figures give every digit
 * the width of a `0`, which makes a large standalone number look loose — they
 * belong on numbers that align in a column (the table views, axis ticks), not
 * on a hero figure. `sub` keeps its tabular figures: those DO align, in a row.
 */
function StatCard({ label, value, sub, t }: { label: string; value: string | number; sub?: string; t: UITemplate }) {
  return (
    <div style={{ ...s.statCard, background: t.cardBg, borderColor: t.panelBorder }}>
      <div style={{ fontSize: TYPE.display, fontWeight: 700, color: t.textPrimary, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: TYPE.sm, color: t.textSecondary, marginTop: SPACE['2xs'] }}>{label}</div>
      {sub && <div className="ec-tabular" style={{ fontSize: TYPE.xs, color: t.textMuted, marginTop: SPACE['3xs'] }}>{sub}</div>}
    </div>
  );
}

/**
 * F5: the series was `t.accent` — a chrome token that also draws focus rings
 * and the timeline's date headings — so "indigo" meant episodic, source volume,
 * growth and activity magnitude at once. One measure runs through this chart,
 * the source bars and the heatmap (a count of memories), so all three take
 * SERIES.primary and its ramp.
 *
 * Titled for what is plotted. "Memory Growth" over a per-day count was a
 * title/encoding mismatch: `count` is a RATE (created that day), and growth is
 * `cumulative`. The rate is the honest thing to draw as an area, because a rate
 * has a real zero baseline; the cumulative curve is a column in the table.
 */
export function GrowthPanel({ w, days }: { w: WindowedAnalytics; days: number }) {
  const t = useTemplateStore((st) => st.activeTemplate);
  return (
    <ChartPanel
      title="Memories per day"
      caption={`${w.total} in ${days} days`}
      table={{
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'count', label: 'Created', numeric: true },
          { key: 'cumulative', label: 'Stored after', numeric: true },
        ],
        rows: w.dailyGrowth.map((d) => ({ date: d.date, count: d.count, cumulative: d.cumulative })),
      }}
    >
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={w.dailyGrowth}>
          <defs>
            <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES.primary} stopOpacity={0.28} />
              <stop offset="100%" stopColor={SERIES.primary} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tick={{ fill: t.textMuted, fontSize: 10 }}
            axisLine={{ stroke: t.panelBorder }}
            tickLine={false}
            tickFormatter={(v: string) => v.slice(5)}
          />
          <YAxis tick={{ fill: t.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
          <Tooltip
            // A hairline crosshair, not recharts' pale full-width band: the
            // reader aims at a date, and the band was brighter than the data.
            cursor={{ stroke: t.panelBorder, strokeWidth: 1 }}
            contentStyle={{ background: t.panelBg, border: `1px solid ${t.panelBorder}`, borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: t.textSecondary }}
            itemStyle={{ color: t.textPrimary }}
          />
          {/* `linear`, not `monotone`: the series is one point per calendar day,
              and a spline draws values between days that do not exist. */}
          <Area type="linear" dataKey="count" name="Created" stroke={SERIES.primary} fill="url(#growthGrad)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}

/**
 * Type distribution. This legend was already correct — coloured dot, ink text,
 * value alongside — so it is the pattern every other type badge in the app was
 * moved onto (F2), via ui/DataMark.
 */
export function TypePanel({ w }: { w: WindowedAnalytics }) {
  const t = useTemplateStore((st) => st.activeTemplate);
  const typeData = Object.entries(w.byType).map(([name, value]) => ({ name, value }));
  return (
    <ChartPanel
      title="By Type"
      caption={`${w.total} in window`}
      table={{
        columns: [
          { key: 'type', label: 'Type' },
          { key: 'count', label: 'Memories', numeric: true },
        ],
        rows: typeData.map((d) => ({ type: typeLabel(d.name), count: d.value })),
      }}
    >
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={typeData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value" paddingAngle={3}>
            {typeData.map((entry) => (
              <Cell key={entry.name} fill={typeFill(entry.name)} />
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
            <DataDot color={typeFill(d.name)} />
            <span className="ec-tabular" style={{ color: t.textSecondary, fontSize: TYPE.sm }}>
              {typeLabel(d.name)}: {d.value}
            </span>
          </div>
        ))}
      </div>
    </ChartPanel>
  );
}

/**
 * Source distribution. M2: was titled "By Source" above a chart plotting 8 of
 * the 15 the tile beside it counted, with no qualifier saying so. F6: the three
 * smallest bars render at roughly 12px, 10px and 5px and were visually
 * identical — their values existed only in a tooltip. Every bar carries its
 * value at the tip now, which is where the mark spec puts it.
 */
export function SourcePanel({ w }: { w: WindowedAnalytics }) {
  const t = useTemplateStore((st) => st.activeTemplate);
  const allSources = Object.entries(w.bySource).sort((a, b) => b[1] - a[1]);
  const sourceData = allSources.slice(0, SOURCE_CHART_LIMIT).map(([name, value]) => ({ name, value }));
  return (
    <ChartPanel
      title="Top Sources"
      caption={`${sourceData.length} of ${w.sourceCount}`}
      table={{
        columns: [
          { key: 'source', label: 'Source' },
          { key: 'count', label: 'Memories', numeric: true },
        ],
        rows: allSources.map(([name, value]) => ({ source: name, count: value })),
      }}
    >
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={sourceData} layout="vertical" margin={{ right: 28 }}>
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
            // recharts' default bar cursor is a full-width pale band that was
            // the brightest thing in the panel and read as another data mark.
            // The hovered bar itself lifts instead.
            cursor={false}
            contentStyle={{ background: t.panelBg, border: `1px solid ${t.panelBorder}`, borderRadius: 8, fontSize: 12 }}
            itemStyle={{ color: t.textPrimary }}
          />
          <Bar
            dataKey="value"
            name="Memories"
            fill={SERIES.primary}
            activeBar={{ fill: ACTIVE_BAR_FILL }}
            barSize={BAR_SIZE}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
          >
            <LabelList dataKey="value" position="right" fill={t.textSecondary} fontSize={10} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}

/**
 * Top concepts. Not a chart — a list of names and counts — but it takes the
 * same container so its `title`-only full value has a keyboard- and
 * touch-reachable twin like everything else on the page (F6).
 */
export function ConceptPanel({ w }: { w: WindowedAnalytics }) {
  const t = useTemplateStore((st) => st.activeTemplate);
  return (
    <ChartPanel
      title="Top Concepts"
      caption={`${Math.min(w.topConcepts.length, w.topConceptsLimit)} of ${w.conceptCount}`}
      table={{
        columns: [
          { key: 'concept', label: 'Concept' },
          { key: 'count', label: 'Memories', numeric: true },
          { key: 'importance', label: 'Avg importance', numeric: true },
        ],
        rows: w.topConcepts.map((c) => ({
          concept: toPlainText(c.concept),
          count: c.count,
          importance: percent(c.avgImportance),
        })),
      }}
    >
      {/* M10: was a ragged flex wrap of chips 100-300px wide whose last row
          left 445px dead, with no truncation. A grid gives one column rhythm;
          the full value stays on `title`. H4 strips the Markdown these
          concepts arrive wrapped in. */}
      <div style={s.conceptGrid}>
        {w.topConcepts.map((c) => {
          const label = toPlainText(c.concept);
          return (
            <div key={c.concept} title={label} style={{ ...s.conceptChip, background: t.inputBg, borderColor: t.panelBorder }}>
              <span style={{ ...s.conceptName, color: t.textPrimary }}>{label}</span>
              <span className="ec-tabular" style={{ color: t.textMuted, fontSize: TYPE.xs }}>
                {c.count} {c.count === 1 ? 'memory' : 'memories'}
              </span>
            </div>
          );
        })}
      </div>
    </ChartPanel>
  );
}

export function HeatmapPanel({ w }: { w: WindowedAnalytics }) {
  return (
    <ChartPanel
      title="Activity Heatmap"
      caption={describeCoverage(w)}
      table={{
        columns: [
          { key: 'day', label: 'Day' },
          { key: 'hour', label: 'Hour' },
          { key: 'count', label: 'Memories', numeric: true },
          { key: 'coverage', label: 'Times that weekday fell', numeric: true },
        ],
        rows: [...w.hourlyActivity]
          .filter((c) => c.count > 0)
          .sort((a, b) => b.count - a.count || a.dayOfWeek - b.dayOfWeek || a.hour - b.hour)
          .map((c) => ({
            day: DAY_NAMES[c.dayOfWeek] ?? String(c.dayOfWeek),
            hour: `${String(c.hour).padStart(2, '0')}:00`,
            count: c.count,
            coverage: w.weekdayCoverage?.[c.dayOfWeek] ?? '',
          })),
      }}
    >
      <ActivityHeatmap data={w.hourlyActivity} />
    </ChartPanel>
  );
}

const s = {
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: SPACE.md,
  },
  statCard: {
    border: '1px solid',
    borderRadius: RADIUS.lg,
    padding: `${SPACE.xl} ${SPACE.xl}`,
  },
  legend: {
    display: 'flex',
    gap: SPACE.md,
    justifyContent: 'center',
    marginTop: SPACE.sm,
    flexWrap: 'wrap' as const,
  },
  legendItem: { display: 'flex', alignItems: 'center', gap: SPACE['2xs'] },
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
} as const;
