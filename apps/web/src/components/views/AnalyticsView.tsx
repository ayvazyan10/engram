import { useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
  BarChart, Bar,
} from 'recharts';
import { useAnalyticsStore } from '../../store/analyticsStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { api } from '../../lib/api.js';

const TYPE_COLORS: Record<string, string> = {
  episodic: '#818cf8',
  semantic: '#22d3ee',
  procedural: '#fbbf24',
};

export default function AnalyticsView() {
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

  if (loading && !data) {
    return (
      <div style={{ ...s.center, color: t.textMuted }}>Loading analytics…</div>
    );
  }

  // A failed request used to be indistinguishable from an empty dataset.
  if (error && !data) {
    return (
      <div style={{ ...s.center, flexDirection: 'column', gap: 12, color: '#ef4444' }}>
        <div>Could not load analytics: {error}</div>
        <button
          style={{
            background: 'transparent',
            border: '1px solid #ef4444',
            color: '#ef4444',
            borderRadius: 6,
            padding: '6px 14px',
            cursor: 'pointer',
            fontSize: 12,
          }}
          onClick={() => {
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
  const sourceData = Object.entries(data.bySource)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, value]) => ({ name, value }));

  return (
    <div style={{ ...s.root, background: t.rootBg }}>
      {/* Stats row */}
      <div style={s.statsRow}>
        <StatCard label="Total Memories" value={data.total} color={t.accent} t={t} />
        <StatCard label="Avg Importance" value={`${(data.avgImportance * 100).toFixed(0)}%`} color="#22d3ee" t={t} />
        <StatCard label="Concepts" value={data.topConcepts.length} color="#fbbf24" t={t} />
        <StatCard label="Sources" value={Object.keys(data.bySource).length} color="#f472b6" t={t} />
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
        <div style={{ ...s.panel, ...s.halfPanel, background: t.cardBg, borderColor: t.panelBorder }}>
          <h3 style={{ ...s.panelTitle, color: t.textPrimary }}>By Type</h3>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={typeData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value" paddingAngle={3}>
                {typeData.map((entry) => (
                  <Cell key={entry.name} fill={TYPE_COLORS[entry.name] ?? '#64748b'} />
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
                <span style={{ ...s.legendDot, background: TYPE_COLORS[d.name] ?? '#64748b' }} />
                <span style={{ color: t.textSecondary, fontSize: '11px' }}>{d.name}: {d.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Source distribution */}
        <div style={{ ...s.panel, ...s.halfPanel, background: t.cardBg, borderColor: t.panelBorder }}>
          <h3 style={{ ...s.panelTitle, color: t.textPrimary }}>By Source</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={sourceData} layout="vertical">
              <XAxis type="number" tick={{ fill: t.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fill: t.textSecondary, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={80}
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
        <div style={s.conceptGrid}>
          {data.topConcepts.map((c) => (
            <div key={c.concept} style={{ ...s.conceptChip, background: t.inputBg, borderColor: t.panelBorder }}>
              <span style={{ color: t.textPrimary, fontSize: '12px', fontWeight: 500 }}>{c.concept}</span>
              <span style={{ color: t.textMuted, fontSize: '10px' }}>{c.count} memories</span>
            </div>
          ))}
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

function StatCard({ label, value, color, t }: { label: string; value: string | number; color: string; t: ReturnType<typeof useTemplateStore.getState>['activeTemplate'] }) {
  return (
    <div style={{ ...s.statCard, background: t.cardBg, borderColor: t.panelBorder }}>
      <div style={{ fontSize: '24px', fontWeight: 700, color, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: '11px', color: t.textMuted, marginTop: '4px' }}>{label}</div>
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

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '500px' }}>
        {grid.map((row, dow) => (
          <div key={dow} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            <span style={{ width: '28px', fontSize: '9px', color: t.textMuted, flexShrink: 0 }}>{days[dow]}</span>
            {row.map((count, h) => {
              const intensity = count / maxCount;
              return (
                <div
                  key={h}
                  title={`${days[dow]} ${h}:00 — ${count} memories`}
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '3px',
                    background: count === 0
                      ? t.inputBg
                      : `rgba(99, 102, 241, ${0.15 + intensity * 0.85})`,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const s = {
  root: {
    flex: 1,
    overflow: 'auto',
    padding: '28px 36px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '20px',
  },
  center: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
  },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: '12px',
  },
  statCard: {
    border: '1px solid',
    borderRadius: '12px',
    padding: '18px 20px',
  },
  panel: {
    border: '1px solid',
    borderRadius: '12px',
    padding: '20px',
  },
  panelTitle: {
    fontSize: '13px',
    fontWeight: 600,
    marginBottom: '16px',
    margin: '0 0 16px 0',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  halfPanel: {},
  legend: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
    marginTop: '8px',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  legendDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    display: 'inline-block',
  },
  conceptGrid: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '8px',
  },
  conceptChip: {
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid',
  },
} as const;
