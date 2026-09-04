import { useEffect, useState } from 'react';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useMemoryStore } from '../../store/memoryStore.js';
import { useTemplateStore, type UITemplate } from '../../store/templateStore.js';
import { api } from '../../lib/api.js';
import { SPACE, STATUS, TYPE, TYPE_COLORS } from '../../lib/tokens.js';

export default function StatusBar() {
  const { neurons } = useNeuralStore();
  const { totalCount, recallLatencyMs, currentContext } = useMemoryStore();
  const t = useTemplateStore((s) => s.activeTemplate);
  const [stats, setStats] = useState<{ byType?: Record<string, number>; bySource?: Record<string, number> } | null>(null);

  useEffect(() => {
    api.stats().then(setStats).catch(() => null);
    const id = setInterval(() => api.stats().then(setStats).catch(() => null), 15000);
    return () => clearInterval(id);
  }, []);

  const total = stats ? Object.values(stats.byType ?? {}).reduce((a, b) => a + b, 0) : totalCount;

  return (
    <div style={{ ...styles.bar, background: t.statusBg, borderTopColor: t.panelBorder, color: t.textMuted }}>
      <div style={styles.left}>
        {stats?.byType && (
          <>
            <Chip label="E" value={stats.byType['episodic'] ?? 0} color={TYPE_COLORS.episodic} title="Episodic memories" t={t} />
            <Chip label="S" value={stats.byType['semantic'] ?? 0} color={TYPE_COLORS.semantic} title="Semantic memories" t={t} />
            <Chip label="P" value={stats.byType['procedural'] ?? 0} color={TYPE_COLORS.procedural} title="Procedural memories" t={t} />
            <div style={{ ...styles.sep, background: t.panelBorder }} />
          </>
        )}
        <span>{total} memories</span>
        <div style={{ ...styles.sep, background: t.panelBorder }} />
        <span>{neurons.length} nodes visible</span>
      </div>

      <div style={styles.center}>
        {currentContext && (
          <span style={styles.contextHint} title={currentContext}>
            ⌂ Context loaded — {currentContext.length} chars
          </span>
        )}
      </div>

      <div style={styles.right}>
        {recallLatencyMs !== null && (
          <>
            <span>recall</span>
            <span style={{ ...styles.latency, color: recallLatencyMs < 100 ? STATUS.success : recallLatencyMs < 300 ? STATUS.warning : STATUS.danger }}>
              {recallLatencyMs}ms
            </span>
            <div style={{ ...styles.sep, background: t.panelBorder }} />
          </>
        )}
        <span style={{ ...styles.brand, color: t.textMuted }}>Engram</span>
      </div>
    </div>
  );
}

function Chip({ label, value, color, title, t }: { label: string; value: number; color: string; title: string; t: UITemplate }) {
  return (
    <div style={styles.chip} title={title}>
      <span style={{ color, fontSize: TYPE.xs, fontWeight: 700 }}>{label}</span>
      <span style={{ color: t.textSecondary, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    padding: `0 ${SPACE.lg}`,
    height: '26px',
    borderTop: '1px solid',
    fontSize: TYPE.sm,
    flexShrink: 0,
    gap: SPACE.sm,
  },
  left: { display: 'flex', alignItems: 'center', gap: SPACE.sm },
  center: { flex: 1, display: 'flex', justifyContent: 'center' },
  right: { display: 'flex', alignItems: 'center', gap: SPACE.sm },
  chip: { display: 'flex', alignItems: 'center', gap: SPACE['2xs'] },
  sep: { width: '1px', height: '12px' },
  latency: { fontWeight: 600, fontSize: TYPE.sm },
  contextHint: { fontSize: TYPE.xs, cursor: 'default' },
  brand: { fontSize: TYPE.xs, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' as const },
} as const;
