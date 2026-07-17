import { useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { useReflectionStore, type ReflectionInsight } from '../../store/reflectionStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { api } from '../../lib/api.js';

const REFLECTION_TYPES = ['pattern', 'knowledge_gap', 'trend', 'contradiction_summary'] as const;

const TYPE_META: Record<string, { icon: string; label: string; color: string }> = {
  pattern: { icon: '◈', label: 'Pattern', color: '#818cf8' },
  knowledge_gap: { icon: '◇', label: 'Knowledge Gap', color: '#f472b6' },
  trend: { icon: '◆', label: 'Trend', color: '#22d3ee' },
  contradiction_summary: { icon: '⬡', label: 'Contradiction', color: '#fbbf24' },
};

export default function ReflectionView() {
  const { insights, llmStatus, loading, reflecting, filterType, setInsights, setLLMStatus, setLoading, setReflecting, setFilterType } = useReflectionStore();
  const t = useTemplateStore((s) => s.activeTemplate);

  useEffect(() => {
    if (!document.getElementById('engram-spin-keyframes')) {
      const style = document.createElement('style');
      style.id = 'engram-spin-keyframes';
      style.textContent = '@keyframes engram-spin{to{transform:rotate(360deg)}}@keyframes engram-shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}';
      document.head.appendChild(style);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getReflections(50, filterType ?? undefined),
      api.getLLMStatus(),
    ])
      .then(([reflRes, status]) => {
        setInsights(reflRes.reflections);
        setLLMStatus(status);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterType, setInsights, setLLMStatus, setLoading]);

  const handleReflect = () => {
    setReflecting(true);
    api.triggerReflection()
      .then((res) => {
        if (res.count > 0) {
          api.getReflections(50, filterType ?? undefined)
            .then((r) => setInsights(r.reflections))
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setReflecting(false));
  };

  return (
    <div style={{ ...s.root, background: t.rootBg }}>
      {/* Header */}
      <div style={s.header}>
        <div>
          <h2 style={{ ...s.title, color: t.textPrimary }}>Memory Reflections</h2>
          <p style={{ ...s.subtitle, color: t.textMuted }}>
            AI-generated insights from your memory patterns
          </p>
        </div>
        <div style={s.headerRight}>
          {llmStatus && (
            <div style={{ ...s.llmBadge, background: t.cardBg, borderColor: t.panelBorder }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: llmStatus.available ? '#22c55e' : '#ef4444', display: 'inline-block' }} />
              <span style={{ color: t.textSecondary, fontSize: '11px' }}>
                {llmStatus.provider} / {llmStatus.model}
              </span>
            </div>
          )}
          <button
            style={{
              ...s.reflectBtn,
              background: reflecting ? t.panelBorder : t.accent,
              opacity: !llmStatus?.available ? 0.4 : 1,
              cursor: reflecting || !llmStatus?.available ? 'not-allowed' : 'pointer',
              position: 'relative' as const,
              overflow: 'hidden' as const,
            }}
            onClick={handleReflect}
            disabled={reflecting || !llmStatus?.available}
          >
            {reflecting && (
              <span style={s.btnSpinner} />
            )}
            {reflecting ? 'Analyzing memories…' : '✦ Reflect Now'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={s.filters}>
        <button
          style={{ ...s.filterBtn, ...(filterType === null ? { background: t.accent + '20', color: t.accent } : { color: t.textSecondary }) }}
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
              style={{ ...s.filterBtn, ...(active ? { background: meta.color + '20', color: meta.color } : { color: t.textSecondary }) }}
              onClick={() => setFilterType(type)}
            >
              {meta.icon} {meta.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {reflecting && (
        <div style={{ ...s.progressBar, background: t.panelBorder }}>
          <div style={{ ...s.progressFill, background: t.accent }} />
        </div>
      )}
      {loading ? (
        <div style={{ ...s.center, color: t.textMuted }}>Loading reflections…</div>
      ) : insights.length === 0 && !reflecting ? (
        <div style={{ ...s.emptyState, borderColor: t.panelBorder }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>◈</div>
          <div style={{ color: t.textSecondary, fontSize: '14px' }}>No reflections yet</div>
          <div style={{ color: t.textMuted, fontSize: '12px', marginTop: '4px' }}>
            {llmStatus?.available
              ? 'Click "Reflect Now" or store more memories to trigger automatic reflection.'
              : 'Configure an LLM provider (Ollama or Claude) to enable reflections.'}
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
          {format(parseISO(insight.createdAt), 'MMM d, HH:mm')}
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
    padding: '28px 36px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '20px',
  },
  header: {
    display: 'flex',
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
  llmBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 10px',
    borderRadius: '6px',
    border: '1px solid',
  },
  reflectBtn: {
    border: 'none',
    borderRadius: '8px',
    padding: '8px 16px',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 600,
    transition: 'background 0.2s, opacity 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  btnSpinner: {
    width: 12,
    height: 12,
    border: '2px solid rgba(255,255,255,0.3)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'engram-spin 0.8s linear infinite',
    flexShrink: 0,
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
  progressBar: {
    height: 3,
    borderRadius: 2,
    overflow: 'hidden' as const,
  },
  progressFill: {
    height: '100%',
    width: '40%',
    borderRadius: 2,
    animation: 'engram-shimmer 1.5s ease-in-out infinite',
  } as React.CSSProperties,
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
