import { useEffect, useState } from 'react';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useMemoryStore } from '../../store/memoryStore.js';
import { api } from '../../lib/api.js';

export default function StatusBar() {
  const { neurons } = useNeuralStore();
  const { totalCount, recallLatencyMs, currentContext } = useMemoryStore();
  const [stats, setStats] = useState<{ byType?: Record<string, number>; bySource?: Record<string, number> } | null>(null);

  useEffect(() => {
    api.stats().then(setStats).catch(() => null);
    const id = setInterval(() => api.stats().then(setStats).catch(() => null), 15000);
    return () => clearInterval(id);
  }, []);

  const total = stats ? Object.values(stats.byType ?? {}).reduce((a, b) => a + b, 0) : totalCount;

  return (
    <div style={styles.bar}>
      <div style={styles.left}>
        {stats?.byType && (
          <>
            <Chip label="E" value={stats.byType['episodic'] ?? 0} color="#6366f1" title="Episodic memories" />
            <Chip label="S" value={stats.byType['semantic'] ?? 0} color="#06b6d4" title="Semantic memories" />
            <Chip label="P" value={stats.byType['procedural'] ?? 0} color="#f59e0b" title="Procedural memories" />
            <div style={styles.sep} />
          </>
        )}
        <span style={styles.muted}>{total} memories</span>
        <div style={styles.sep} />
        <span style={styles.muted}>{neurons.length} nodes visible</span>
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
            <span style={styles.muted}>recall</span>
            <span style={{ ...styles.latency, color: recallLatencyMs < 100 ? '#22c55e' : recallLatencyMs < 300 ? '#f59e0b' : '#ef4444' }}>
              {recallLatencyMs}ms
            </span>
            <div style={styles.sep} />
          </>
        )}
        <span style={styles.brand}>Engram</span>
      </div>
    </div>
  );
}

function Chip({ label, value, color, title }: { label: string; value: number; color: string; title: string }) {
  return (
    <div style={styles.chip} title={title}>
      <span style={{ color, fontSize: '10px', fontWeight: 700 }}>{label}</span>
      <span style={styles.chipVal}>{value}</span>
    </div>
  );
}

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    padding: '0 16px',
    height: '26px',
    background: '#040c1a',
    borderTop: '1px solid #0f2040',
    fontSize: '11px',
    color: '#475569',
    flexShrink: 0,
    gap: '8px',
  },
  left: { display: 'flex', alignItems: 'center', gap: '8px' },
  center: { flex: 1, display: 'flex', justifyContent: 'center' },
  right: { display: 'flex', alignItems: 'center', gap: '8px' },
  chip: { display: 'flex', alignItems: 'center', gap: '4px' },
  chipVal: { color: '#334155', fontWeight: 500 },
  sep: { width: '1px', height: '12px', background: '#0f2040' },
  muted: { color: '#334155' },
  latency: { fontWeight: 600, fontSize: '11px' },
  contextHint: { color: '#334155', fontSize: '10px', cursor: 'default' },
  brand: { color: '#1e3050', fontSize: '10px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' as const },
} as const;
