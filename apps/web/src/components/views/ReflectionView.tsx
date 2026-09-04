import { useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { useReflectionStore, type ReflectionInsight } from '../../store/reflectionStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { api } from '../../lib/api.js';
import { STATUS, withAlpha } from '../../lib/tokens.js';
import { safeParseISO } from '../../lib/dates.js';

const REFLECTION_TYPES = ['pattern', 'knowledge_gap', 'trend', 'contradiction_summary'] as const;

const TYPE_META: Record<string, { icon: string; label: string; color: string }> = {
  pattern: { icon: '◈', label: 'Pattern', color: '#818cf8' },
  knowledge_gap: { icon: '◇', label: 'Knowledge Gap', color: '#f472b6' },
  trend: { icon: '◆', label: 'Trend', color: '#22d3ee' },
  contradiction_summary: { icon: '⬡', label: 'Contradiction', color: '#fbbf24' },
};

export default function ReflectionView() {
  const { insights, status, loading, filterType, error, setInsights, setStatus, setLoading, setFilterType, setError } = useReflectionStore();
  const t = useTemplateStore((s) => s.activeTemplate);

  // W6: bumped per load, captured per-call, so a stale response (the
  // "Pattern" tab's request resolving after the user has already switched to
  // "Trend") can be told apart from the current one instead of unconditionally
  // overwriting whatever is on screen.
  const latestRequestId = useRef(0);

  useEffect(() => {
    const requestId = ++latestRequestId.current;
    setLoading(true);
    Promise.all([
      api.getReflections(50, filterType ?? undefined),
      api.getReflectionStatus(),
    ])
      .then(([reflRes, statusRes]) => {
        if (requestId !== latestRequestId.current) return; // superseded — drop it
        setInsights(reflRes.reflections);
        setStatus(statusRes);
        // A prior failed load must not go on shadowing a reload that has
        // since succeeded — only the user dismissing it cleared this before,
        // so a transient failure permanently read as "Could not reach
        // Engram API" even once the API was reachable again.
        setError(null);
      })
      .catch(() => {
        if (requestId !== latestRequestId.current) return; // superseded — drop it
        setError('Could not reach Engram API');
      })
      .finally(() => {
        if (requestId === latestRequestId.current) setLoading(false);
      });
  }, [filterType, setInsights, setStatus, setLoading, setError]);

  const remaining = status ? Math.max(0, status.threshold - status.counter) : null;

  return (
    <div style={{ ...s.root, background: t.rootBg }}>
      {/* Header */}
      <div style={s.header}>
        <div>
          <h2 style={{ ...s.title, color: t.textPrimary }}>Memory Reflections</h2>
          <p style={{ ...s.subtitle, color: t.textMuted }}>
            Insights the AI connected to Engram draws from your memory patterns
          </p>
        </div>
        <div style={s.headerRight}>
          {status && (
            <div style={{ ...s.statusPill, background: t.cardBg, borderColor: t.panelBorder }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: !status.enabled ? '#6b7280' : status.due ? '#fbbf24' : '#22c55e',
                  display: 'inline-block',
                }}
              />
              <span style={{ color: t.textSecondary, fontSize: '11px' }}>
                {!status.enabled
                  ? 'Reflection off'
                  : status.due
                    ? 'Reflection due'
                    : `${remaining} store${remaining === 1 ? '' : 's'} to next`}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Due hint — reflection is AI-driven, not server-generated */}
      {status?.due && (
        <div style={{ ...s.dueBanner, background: '#fbbf2415', borderColor: '#fbbf24' }}>
          <span style={{ color: '#f59e0b', fontSize: '13px' }}>
            A reflection cycle is due. Ask the AI connected to Engram to run <code style={s.code}>request_reflection</code>, then <code style={s.code}>store_reflection</code> for each insight it finds.
          </span>
        </div>
      )}

      {/* Filters */}
      <div style={s.filters}>
        <button
          className="ec-hover-tint"
          style={{ ...s.filterBtn, ...(filterType === null ? { background: withAlpha(t.accent, 0.13), color: t.accent } : { color: t.textSecondary }) }}
          onClick={() => setFilterType(null)}
        >
          All
        </button>
        {REFLECTION_TYPES.map((type) => {
          const meta = TYPE_META[type]!;
          const active = filterType === type;
          return (
            <button
              key={type}
              className="ec-hover-tint"
              style={{ ...s.filterBtn, ...(active ? { background: withAlpha(meta.color, 0.13), color: meta.color } : { color: t.textSecondary }) }}
              onClick={() => setFilterType(type)}
            >
              {meta.icon} {meta.label}
            </button>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div style={{ ...s.errorBanner, background: withAlpha(STATUS.danger, 0.08), borderColor: STATUS.danger }}>
          <span style={{ color: STATUS.danger, fontSize: '13px' }}>{error}</span>
          <button
            className="ec-hover-bright"
            style={{ background: 'none', border: 'none', color: STATUS.danger, fontSize: '16px', padding: 0, lineHeight: 1 }}
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={{ ...s.center, color: t.textMuted }}>Loading reflections…</div>
      ) : insights.length === 0 ? (
        <div style={{ ...s.emptyState, borderColor: t.panelBorder }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>◈</div>
          <div style={{ color: t.textSecondary, fontSize: '14px' }}>No reflections yet</div>
          <div style={{ color: t.textMuted, fontSize: '12px', marginTop: '4px', maxWidth: 380, textAlign: 'center' }}>
            Reflections are generated by the AI connected to Engram via MCP
            (<code style={s.code}>request_reflection</code> → <code style={s.code}>store_reflection</code>).
            They appear here once stored.
          </div>
        </div>
      ) : (
        <div style={s.grid}>
          {insights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))}
        </div>
      )}
    </div>
  );
}

function InsightCard({ insight }: { insight: ReflectionInsight }) {
  const t = useTemplateStore((s) => s.activeTemplate);
  const meta = TYPE_META[insight.type] ?? { icon: '•', label: insight.type, color: t.accent };

  return (
    <div style={{ ...s.card, background: t.cardBg, borderColor: t.panelBorder }}>
      <div style={s.cardTop}>
        <span style={{ ...s.cardType, background: meta.color + '15', color: meta.color }}>
          {meta.icon} {meta.label}
        </span>
        <span style={{ color: t.textMuted, fontSize: '10px' }}>
          {/* W10: an unparsable createdAt must not throw — there is no
              error boundary anywhere, so one bad row used to blank the
              whole app permanently. */}
          {(() => {
            const parsed = safeParseISO(insight.createdAt);
            return parsed ? format(parsed, 'MMM d, HH:mm') : 'Unknown date';
          })()}
        </span>
      </div>
      <div style={{ ...s.cardContent, color: t.textPrimary }}>
        {insight.content}
      </div>
      <div style={s.cardBottom}>
        <span style={{ color: t.textMuted, fontSize: '10px' }}>
          Confidence: {(insight.confidence * 100).toFixed(0)}%
        </span>
        <span style={{ color: t.textMuted, fontSize: '10px' }}>
          Importance: {(insight.importance * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

const s = {
  root: {
    flex: 1,
    overflow: 'auto',
    padding: 'clamp(16px, 4vw, 28px) clamp(16px, 5vw, 36px)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '20px',
  },
  header: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '12px',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: '18px',
    fontWeight: 700,
    margin: 0,
    letterSpacing: '-0.02em',
  },
  subtitle: {
    fontSize: '12px',
    margin: '4px 0 0',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  statusPill: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 10px',
    borderRadius: '6px',
    border: '1px solid',
  },
  dueBanner: {
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid',
  },
  code: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    padding: '1px 4px',
    borderRadius: '4px',
    background: 'rgba(148,163,184,0.16)',
  } as React.CSSProperties,
  filters: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap' as const,
  },
  filterBtn: {
    background: 'transparent',
    border: 'none',
    borderRadius: '6px',
    padding: '5px 12px',
    fontSize: '11px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid',
  },
  center: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px dashed',
    borderRadius: '12px',
    padding: '48px',
  },
  grid: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px',
  },
  card: {
    border: '1px solid',
    borderRadius: '10px',
    padding: '16px 18px',
    transition: 'transform 0.12s',
  },
  cardTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '10px',
  },
  cardType: {
    fontSize: '10px',
    fontWeight: 600,
    padding: '3px 8px',
    borderRadius: '4px',
    letterSpacing: '0.02em',
  },
  cardContent: {
    fontSize: '13px',
    lineHeight: '1.6',
    marginBottom: '10px',
  },
  cardBottom: {
    display: 'flex',
    gap: '16px',
  },
} as const;
