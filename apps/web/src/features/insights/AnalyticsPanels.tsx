import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar, LabelList } from 'recharts';
import { format } from 'date-fns';
import type { AnalyticsData, WindowedAnalytics } from '../../store/analyticsStore.js';
import { safeParseISO } from '../../lib/dates.js';
import { toPlainText } from '../../lib/plainText.js';
import { TypeMark } from '../memory/MemoryRow.js';
import ChartPanel from './ChartPanel.js';
import ActivityHeatmap from './ActivityHeatmap.js';
import {
  BAR_SIZE, DAY_NAMES, SOURCE_AXIS_WIDTH, SOURCE_CHART_LIMIT, TYPE_ORDER,
  describeCoverage, percent, truncateSourceLabel, typeLabel,
} from './format.js';

/**
 * The Numbers panels. Everything here is windowed except the figures' "of"
 * lines, which say all-time; the tab prints the window once, above all of it.
 * Colours are tokens: counts of memories take `--series`, a type takes its own
 * hue and shape, text is always ink.
 */

const AXIS_TICK = { fill: 'var(--ink-3)', fontSize: 11 };

export function shortDay(value: string): string {
  const parsed = safeParseISO(value);
  return parsed ? format(parsed, 'd MMM') : value;
}

/** The four figures, each with its all-time denominator. */
export function StatsRow({ data }: { data: AnalyticsData }) {
  const w = data.windowed;
  const all = data.allTime;
  return (
    <dl className="in-figures">
      <Figure label="Memories stored" value={w.total.toLocaleString('en-US')} sub={`of ${all.total.toLocaleString('en-US')} in the store`} />
      <Figure label="Average importance" value={percent(w.avgImportance)} sub={`${percent(all.avgImportance)} across the store`} />
      <Figure label="Sources" value={String(w.sourceCount)} sub={`of ${all.sourceCount} that ever wrote`} />
      <Figure label="Concepts" value={w.conceptCount.toLocaleString('en-US')} sub={`of ${all.conceptCount.toLocaleString('en-US')} all-time`} />
    </dl>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="in-figure">
      <dt>{label}</dt>
      <dd>
        <b>{value}</b>
        <small>{sub}</small>
      </dd>
    </div>
  );
}

/** Values lead, labels follow. */
export function GrowthTip({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const n = Number(payload[0]?.value ?? 0);
  return (
    <div className="in-tip">
      <b>{n.toLocaleString('en-US')}</b> {n === 1 ? 'memory' : 'memories'}
      <small>{label ? shortDay(label) : ''}</small>
    </div>
  );
}

/**
 * Memories created per day: a rate, so it has a real zero and an area is
 * honest. `linear`: one point per calendar day, no spline between days that
 * do not exist. The running total is a column in the table.
 */
export function GrowthPanel({ w, days }: { w: WindowedAnalytics; days: number }) {
  return (
    <ChartPanel
      title="Memories per day"
      caption={`${w.total.toLocaleString('en-US')} in ${days} days`}
      wide
      table={{
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'count', label: 'Stored that day', numeric: true },
          { key: 'cumulative', label: 'In the store after', numeric: true },
        ],
        rows: w.dailyGrowth.map((d) => ({ date: d.date, count: d.count, cumulative: d.cumulative })),
      }}
    >
      <div className="in-chart">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={w.dailyGrowth} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--rule)" strokeOpacity={0.6} />
            <XAxis
              dataKey="date"
              tick={AXIS_TICK}
              axisLine={{ stroke: 'var(--rule)' }}
              tickLine={false}
              tickFormatter={shortDay}
              minTickGap={24}
            />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
            <Tooltip cursor={{ stroke: 'var(--ink-3)', strokeWidth: 1 }} content={<GrowthTip />} />
            <Area
              type="linear"
              dataKey="count"
              name="Stored"
              stroke="var(--series)"
              strokeWidth={2}
              fill="var(--series)"
              fillOpacity={0.1}
              activeDot={{ r: 4, fill: 'var(--series)', stroke: 'var(--raised)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartPanel>
  );
}

/** The window's type split, in the fixed type order, without empty types. */
export function typeRows(w: WindowedAnalytics): { type: (typeof TYPE_ORDER)[number]; count: number }[] {
  return TYPE_ORDER.map((type) => ({ type, count: w.byType[type] ?? 0 })).filter((r) => r.count > 0);
}

/**
 * The type split as one stacked bar, part to whole, with a 2px gap between
 * segments. Each type is a shape and a word beside its hue, never colour alone.
 */
export function TypePanel({ w }: { w: WindowedAnalytics }) {
  const rows = typeRows(w);
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <ChartPanel
      title="By type"
      caption={`${total.toLocaleString('en-US')} in the window`}
      table={{
        columns: [
          { key: 'type', label: 'Type' },
          { key: 'count', label: 'Memories', numeric: true },
          { key: 'share', label: 'Share', numeric: true },
        ],
        rows: rows.map((r) => ({ type: typeLabel(r.type), count: r.count, share: percent(total ? r.count / total : null) })),
      }}
    >
      <div className="in-stack" role="img" aria-label={rows.map((r) => `${typeLabel(r.type)} ${r.count}`).join(', ')}>
        {rows.map((r) => (
          <i key={r.type} data-type={r.type} style={{ flexGrow: r.count }} />
        ))}
      </div>
      <ul className="in-legend">
        {rows.map((r) => (
          <li key={r.type}>
            <TypeMark type={r.type} size={12} />
            <span>{typeLabel(r.type)}</span>
            <b>{r.count.toLocaleString('en-US')}</b>
            <small>{percent(total ? r.count / total : null)}</small>
          </li>
        ))}
      </ul>
    </ChartPanel>
  );
}

/** The window's sources, most first: the chart plots the top few, the table all. */
export function sourceRows(w: WindowedAnalytics): { name: string; value: number }[] {
  return Object.entries(w.bySource)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, value]) => ({ name, value }));
}

/** Who wrote the window's memories: one series, so one colour, values at the tips. */
export function SourcePanel({ w }: { w: WindowedAnalytics }) {
  const all = sourceRows(w);
  const shown = all.slice(0, SOURCE_CHART_LIMIT);
  return (
    <ChartPanel
      title="Who writes your memories"
      caption={shown.length < all.length ? `Top ${shown.length} of ${all.length} sources` : `${all.length} ${all.length === 1 ? 'source' : 'sources'}`}
      table={{
        columns: [
          { key: 'source', label: 'Source' },
          { key: 'count', label: 'Memories', numeric: true },
        ],
        rows: all.map((s) => ({ source: s.name, count: s.value })),
      }}
    >
      <div className="in-chart">
        <ResponsiveContainer width="100%" height={Math.max(80, shown.length * 30 + 8)}>
          <BarChart data={shown} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }} barCategoryGap={8}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: 'var(--ink-2)', fontSize: 12.5 }}
              axisLine={false}
              tickLine={false}
              width={SOURCE_AXIS_WIDTH}
              tickFormatter={truncateSourceLabel}
            />
            <Bar dataKey="value" name="Memories" fill="var(--series)" barSize={BAR_SIZE} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList dataKey="value" position="right" fill="var(--ink)" fontSize={12.5} fontWeight={600} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartPanel>
  );
}

/** The window's most frequent concepts: a ranked list with counts, not a chart. */
export function ConceptPanel({ w }: { w: WindowedAnalytics }) {
  const max = Math.max(1, ...w.topConcepts.map((c) => c.count));
  return (
    <ChartPanel
      title="Top concepts"
      caption={`${Math.min(w.topConcepts.length, w.topConceptsLimit)} of ${w.conceptCount.toLocaleString('en-US')}`}
      wide
      table={{
        columns: [
          { key: 'concept', label: 'Concept' },
          { key: 'count', label: 'Memories', numeric: true },
          { key: 'importance', label: 'Average importance', numeric: true },
        ],
        rows: w.topConcepts.map((c) => ({ concept: toPlainText(c.concept), count: c.count, importance: percent(c.avgImportance) })),
      }}
    >
      <ol className="in-concepts">
        {w.topConcepts.map((c) => {
          const label = toPlainText(c.concept);
          return (
            <li key={c.concept} title={label}>
              <span className="in-concept-t">{label}</span>
              <span className="in-concept-n">{c.count}</span>
              <i style={{ width: `${(c.count / max) * 100}%` }} aria-hidden="true" />
            </li>
          );
        })}
      </ol>
    </ChartPanel>
  );
}

export function HeatmapPanel({ w }: { w: WindowedAnalytics }) {
  return (
    <ChartPanel
      title="When memories arrive"
      caption={describeCoverage(w)}
      wide
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
