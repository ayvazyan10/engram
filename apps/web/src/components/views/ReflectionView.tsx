import { useEffect, useRef, useState } from 'react';
import { useReflectionStore, type ReflectionInsight } from '../../store/reflectionStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { api } from '../../lib/api.js';
import {
  GLYPH, MEASURE, RADIUS, SPACE, STATUS, TYPE, withAlpha,
} from '../../lib/tokens.js';
import { formatDateTime } from '../../lib/dates.js';
import { toPlainText } from '../../lib/plainText.js';

const REFLECTION_TYPES = ['pattern', 'knowledge_gap', 'trend', 'contradiction_summary'] as const;

/**
 * F5: these four used to carry a `color` each, and three of them were
 * byte-identical to a memory-type slot — pattern === episodic, trend ===
 * semantic, contradiction === procedural, ΔE 0.0. A stored reflection IS a
 * memory, so its insight chip and its type badge can sit on screen together;
 * one categorical slot cannot own two identities. The colour is gone rather
 * than re-slotted (see lib/tokens.ts for the full reasoning) — the glyph and
 * the spelled-out label were always carrying the identity anyway, and the
 * colour was additionally being used as TEXT, which the mark rules forbid.
 */
const TYPE_META: Record<string, { icon: string; label: string }> = {
  pattern: { icon: GLYPH.pattern, label: 'Pattern' },
  knowledge_gap: { icon: GLYPH.knowledgeGap, label: 'Knowledge Gap' },
  trend: { icon: GLYPH.trend, label: 'Trend' },
  contradiction_summary: { icon: GLYPH.contradiction, label: 'Contradiction' },
};

interface Props {
  /** The app-level memory load state AppLayout threads to every view. This
   *  view owns its own reflections request; these stand in when it has
   *  nothing of its own to say, and `onRetry` is wired into the banner's
   *  Retry alongside a refetch of the reflections themselves. */
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export default function ReflectionView({ loading: appLoading, error: appError, onRetry }: Props) {
  const { insights, status, loading, filterType, error, setInsights, setStatus, setLoading, setFilterType, setError } = useReflectionStore();
  const t = useTemplateStore((s) => s.activeTemplate);
  const [reloadToken, setReloadToken] = useState(0);

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
  }, [filterType, reloadToken, setInsights, setStatus, setLoading, setError]);

  const remaining = status ? Math.max(0, status.threshold - status.counter) : null;
  const failure = error ?? appError ?? null;

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
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: !status.enabled ? t.textMuted : status.due ? STATUS.warning : STATUS.success,
                  display: 'inline-block',
                }}
              />
              <span style={{ color: t.textSecondary, fontSize: TYPE.sm }}>
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

      {/* Due hint — reflection is AI-driven, not server-generated. M8: the
          banner concatenated alpha onto a hex string ('#fbbf2415'), the exact
          pattern withAlpha exists to replace. */}
      {status?.due && (
        <div style={{ ...s.dueBanner, background: withAlpha(STATUS.warning, 0.08), borderColor: STATUS.warning }}>
          <span style={{ color: STATUS.warning, fontSize: TYPE.md }}>
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
              style={{ ...s.filterBtn, ...(active ? { background: withAlpha(t.accent, 0.13), color: t.accent } : { color: t.textSecondary }) }}
              onClick={() => setFilterType(type)}
            >
              <span aria-hidden="true">{meta.icon}</span> {meta.label}
            </button>
          );
        })}
      </div>

      {/* Error */}
      {failure && (
        <div style={{ ...s.errorBanner, background: withAlpha(STATUS.danger, 0.08), borderColor: STATUS.danger }}>
          <span style={{ color: STATUS.danger, fontSize: TYPE.md }}>{failure}</span>
          <div style={s.errorActions}>
            <button
              className="ec-hover-tint"
              style={{ ...s.retryBtn, color: STATUS.danger, borderColor: withAlpha(STATUS.danger, 0.35) }}
              onClick={() => {
                setError(null);
                onRetry?.();
                setReloadToken((n) => n + 1);
              }}
            >
              Retry
            </button>
            <button
              className="ec-hover-bright"
              style={{ background: 'none', border: 'none', color: STATUS.danger, fontSize: TYPE.xl, padding: 0, lineHeight: 1 }}
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {loading || appLoading ? (
        <div style={{ ...s.center, color: t.textMuted }}>Loading reflections…</div>
      ) : insights.length === 0 ? (
        <div style={{ ...s.emptyState, borderColor: t.panelBorder }}>
          <div aria-hidden="true" style={{ fontSize: TYPE.glyph, marginBottom: SPACE.md }}>◈</div>
          <div style={{ color: t.textSecondary, fontSize: TYPE.lg }}>No reflections yet</div>
          <div style={{ color: t.textMuted, fontSize: TYPE.base, marginTop: SPACE['2xs'], maxWidth: 380, textAlign: 'center' }}>
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
  const meta = TYPE_META[insight.type] ?? { icon: '•', label: insight.type };

  return (
    <div style={{ ...s.card, background: t.cardBg, borderColor: t.panelBorder }}>
      <div style={s.cardTop}>
        {/* F5: was a tint of this insight type's own colour, with the label
            painted in it. Neutral chip, ink label, glyph carries the type. */}
        <span style={{ ...s.cardType, background: t.inputBg, color: t.textSecondary }}>
          <span aria-hidden="true">{meta.icon}</span> {meta.label}
        </span>
        {/* W10: an unparsable createdAt must not throw — there is no error
            boundary anywhere, so one bad row used to blank the whole app
            permanently. M13: one named format, not a fourth ad-hoc one. */}
        <span className="ec-tabular" style={{ color: t.textMuted, fontSize: TYPE.xs }}>
          {formatDateTime(insight.createdAt)}
        </span>
      </div>
      {/* H3: this box measured 1330px at 13px — about 205 characters per
          line, where readable measure is 45-75. The card stays full width so
          the badge/date row and the footer still span it; only the running
          text is capped. H4: and it printed raw Markdown. */}
      <div className="ec-wrap-anywhere" style={{ ...s.cardContent, color: t.textPrimary }}>
        {toPlainText(insight.content)}
      </div>
      <div style={s.cardBottom}>
        <span className="ec-tabular" style={{ color: t.textMuted, fontSize: TYPE.xs }}>
          {GLYPH.confidence} Confidence: {(insight.confidence * 100).toFixed(0)}%
        </span>
        <span className="ec-tabular" style={{ color: t.textMuted, fontSize: TYPE.xs }}>
          {GLYPH.importance} Importance: {(insight.importance * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

// M7: every size and space here was a raw literal — radius 12px, spacing
// 5/10/14/16/18/48px, font sizes as strings. Substituted to the nearest
// scale step.
const s = {
  root: {
    flex: 1,
    overflow: 'auto',
    padding: 'clamp(16px, 4vw, 28px) clamp(16px, 5vw, 36px)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: SPACE.xl,
  },
  header: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: SPACE.md,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: TYPE['2xl'],
    fontWeight: 700,
    margin: 0,
    letterSpacing: '-0.02em',
  },
  subtitle: {
    fontSize: TYPE.base,
    margin: `${SPACE['2xs']} 0 0`,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE.md,
  },
  statusPill: {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE.xs,
    padding: `${SPACE.xs} ${SPACE.md}`,
    borderRadius: RADIUS.sm,
    border: '1px solid',
  },
  dueBanner: {
    padding: `${SPACE.md} ${SPACE.lg}`,
    borderRadius: RADIUS.md,
    border: '1px solid',
  },
  code: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: TYPE.base,
    padding: `1px ${SPACE['2xs']}`,
    borderRadius: RADIUS.tight,
    background: 'rgba(148,163,184,0.16)',
  } as React.CSSProperties,
  filters: {
    display: 'flex',
    gap: SPACE.xs,
    flexWrap: 'wrap' as const,
  },
  filterBtn: {
    background: 'transparent',
    border: 'none',
    borderRadius: RADIUS.sm,
    padding: `${SPACE.xs} ${SPACE.md}`,
    fontSize: TYPE.sm,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 24,
    transition: 'background 0.15s',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.md,
    padding: `${SPACE.md} ${SPACE.lg}`,
    borderRadius: RADIUS.md,
    border: '1px solid',
  },
  errorActions: {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE.md,
    flexShrink: 0,
  },
  retryBtn: {
    background: 'transparent',
    border: '1px solid',
    borderRadius: RADIUS.tight,
    padding: `${SPACE['3xs']} ${SPACE.sm}`,
    fontSize: TYPE.sm,
    fontWeight: 600,
    fontFamily: 'inherit',
    minHeight: 24,
  },
  center: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: TYPE.lg,
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px dashed',
    borderRadius: RADIUS.lg,
    padding: SPACE['3xl'],
  },
  grid: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: SPACE.md,
  },
  card: {
    border: '1px solid',
    borderRadius: RADIUS.lg,
    padding: `${SPACE.lg} ${SPACE.xl}`,
    transition: 'transform 0.12s',
  },
  cardTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.sm,
    marginBottom: SPACE.md,
  },
  cardType: {
    fontSize: TYPE.xs,
    fontWeight: 600,
    padding: `${SPACE['3xs']} ${SPACE.sm}`,
    borderRadius: RADIUS.tight,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap' as const,
  },
  cardContent: {
    fontSize: TYPE.md,
    lineHeight: 1.6,
    marginBottom: SPACE.md,
    maxWidth: MEASURE.readable,
  },
  cardBottom: {
    display: 'flex',
    gap: SPACE.lg,
    flexWrap: 'wrap' as const,
  },
} as const;
