import { useEffect, useState } from 'react';
import NeuralCanvas from '../canvas/NeuralCanvas.js';
import MemoryPanel from '../ui/MemoryPanel.js';
import SearchBar from '../ui/SearchBar.js';
import StatusBar from '../ui/StatusBar.js';
import NeuronInspector from '../ui/NeuronInspector.js';
import ViewSwitcher from '../ui/ViewSwitcher.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { useViewStore } from '../../store/viewStore.js';
import { api } from '../../lib/api.js';
import { useWebSocket } from '../../hooks/useWebSocket.js';

export default function AppLayout() {
  const { setNeurons, setConnections } = useNeuralStore();
  const { records, setRecords } = useMemoryStore();
  const { activeView } = useViewStore();
  const [loading, setLoading] = useState(true);

  useWebSocket();

  // Load memories once on mount
  useEffect(() => {
    api.listMemories({ limit: 200 })
      .then((res) => setRecords(res.memories as MemoryRecord[]))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [setRecords]);

  // Re-layout whenever records OR active view changes
  useEffect(() => {
    if (records.length === 0) return;
    const positions = activeView.layout(records);
    setNeurons(positions.map((p) => ({ ...p, activation: 0 })));
  }, [records, activeView, setNeurons]);

  // Load connections (once after first data load)
  useEffect(() => {
    if (records.length === 0) return;
    const top = [...records].sort((a, b) => b.importance - a.importance).slice(0, 30);
    Promise.all(top.map((m) => api.getGraph(m.id).catch(() => null))).then((graphs) => {
      const all: Parameters<typeof setConnections>[0] = [];
      graphs.forEach((g, i) => {
        if (!g) return;
        const src = top[i]!.id;
        const data = g as { connections: Array<{ id: string; targetId?: string; target_id?: string; relationship: string; strength: number }> };
        data.connections?.forEach((c) => {
          all.push({ id: c.id, sourceId: src, targetId: c.targetId ?? c.target_id ?? '', relationship: c.relationship, strength: c.strength });
        });
      });
      setConnections(all);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records.length > 0]);

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>⬡</span>
          <span style={styles.logoText}>Engram</span>
          <span style={styles.logoBadge}>v0.1</span>
        </div>

        <ViewSwitcher />

        <ConnectionDot />
      </div>

      {/* Main */}
      <div style={styles.main}>
        <div style={styles.sidebar}>
          <SearchBar />
          <MemoryPanel loading={loading} />
        </div>

        <div style={styles.canvas}>
          {loading && records.length === 0 ? (
            <div style={styles.loadingOverlay}>
              <div style={styles.spinner} />
              <div style={styles.loadingText}>Loading neural graph…</div>
            </div>
          ) : (
            <NeuralCanvas />
          )}
        </div>

        <div style={styles.inspector}>
          <NeuronInspector />
        </div>
      </div>

      <StatusBar />
    </div>
  );
}

function ConnectionDot() {
  const { isConnected } = useNeuralStore();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: isConnected ? '#22c55e' : '#64748b' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: isConnected ? '#22c55e' : '#475569', display: 'inline-block', boxShadow: isConnected ? '0 0 6px #22c55e88' : 'none' }} />
      {isConnected ? 'Live' : 'Offline'}
    </div>
  );
}

const styles = {
  root: { display: 'flex', flexDirection: 'column' as const, width: '100%', height: '100%', background: '#020817', overflow: 'hidden' },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    height: '46px',
    background: '#040d1e',
    borderBottom: '1px solid #0f2040',
    flexShrink: 0,
    gap: '16px',
  },
  logo: { display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 },
  logoIcon: { fontSize: '16px', color: '#6366f1' },
  logoText: { fontSize: '13px', fontWeight: 700, color: '#e2e8f0', letterSpacing: '-0.02em' },
  logoBadge: { fontSize: '10px', color: '#334155', background: '#0a1628', padding: '1px 5px', borderRadius: '4px' },
  main: { flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 },
  sidebar: { width: '260px', flexShrink: 0, display: 'flex', flexDirection: 'column' as const, borderRight: '1px solid #0f2040', background: '#060e1e', overflow: 'hidden' },
  canvas: { flex: 1, position: 'relative' as const, overflow: 'hidden', minWidth: 0, height: '100%' },
  inspector: { width: '252px', flexShrink: 0, borderLeft: '1px solid #0f2040', background: '#060e1e', overflow: 'hidden', display: 'flex', flexDirection: 'column' as const },
  loadingOverlay: { position: 'absolute' as const, inset: 0, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: '12px', background: '#050510' },
  spinner: { width: '28px', height: '28px', border: '2px solid #1e293b', borderTop: '2px solid #6366f1', borderRadius: '50%' },
  loadingText: { fontSize: '12px', color: '#334155' },
} as const;
