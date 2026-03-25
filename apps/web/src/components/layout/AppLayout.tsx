import { useEffect, useState } from 'react';
import NeuralCanvas from '../canvas/NeuralCanvas.js';
import MemoryPanel from '../ui/MemoryPanel.js';
import SearchBar from '../ui/SearchBar.js';
import StatusBar from '../ui/StatusBar.js';
import NeuronInspector from '../ui/NeuronInspector.js';
import ViewSwitcher from '../ui/ViewSwitcher.js';
import TemplateSwitcher from '../ui/TemplateSwitcher.js';
import StoreMemoryModal from '../ui/StoreMemoryModal.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { useViewStore } from '../../store/viewStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { api } from '../../lib/api.js';
import { useWebSocket } from '../../hooks/useWebSocket.js';

export default function AppLayout() {
  const { neurons, setNeurons, setTargetPositions, setConnections, setContradictionPairs } = useNeuralStore();
  const { records, setRecords } = useMemoryStore();
  const { activeView } = useViewStore();
  const t = useTemplateStore((s) => s.activeTemplate);
  const [loading, setLoading] = useState(true);
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [firstLoad, setFirstLoad] = useState(true);

  useWebSocket();

  // Load memories once on mount
  useEffect(() => {
    api.listMemories({ limit: 200 })
      .then((res) => setRecords(res.memories as MemoryRecord[]))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [setRecords]);

  // Load contradictions
  useEffect(() => {
    if (records.length === 0) return;
    api.getContradictions()
      .then((res) => {
        setContradictionPairs(
          res.contradictions.map((c) => ({
            sourceId: c.source.id,
            targetId: c.target.id,
            confidence: c.confidence,
          }))
        );
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records.length > 0]);

  // Re-layout whenever records OR active view changes
  useEffect(() => {
    if (records.length === 0) return;
    const positions = activeView.layout(records);

    if (firstLoad || neurons.length === 0) {
      setNeurons(positions.map((p) => ({ ...p, activation: 0, tx: p.x, ty: p.y, tz: p.z })));
      setFirstLoad(false);
    } else {
      setTargetPositions(positions);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, activeView]);

  // Load connections (once after first data load)
  useEffect(() => {
    if (records.length === 0) return;
    const top = [...records].sort((a, b) => b.importance - a.importance).slice(0, 30);
    Promise.all(top.map((m) => api.getGraph(m.id).catch(() => null))).then((graphs) => {
      const all: Parameters<typeof setConnections>[0] = [];
      graphs.forEach((g, i) => {
        if (!g) return;
        const src = top[i]!.id;
        g.connections?.forEach((c) => {
          all.push({ id: c.id, sourceId: c.sourceId || src, targetId: c.targetId, relationship: c.relationship, strength: c.strength });
        });
      });
      setConnections(all);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records.length > 0]);

  return (
    <div style={{ ...s.root, background: t.rootBg }}>
      {/* Header */}
      <div style={{ ...s.header, background: t.headerBg, borderBottomColor: t.headerBorder }}>
        <div style={s.logo}>
          <span style={{ ...s.logoIcon, color: t.accent }}>⬡</span>
          <span style={{ ...s.logoText, color: t.textPrimary }}>Engram</span>
          <span style={{ ...s.logoBadge, color: t.textMuted, background: t.cardBg }}>v0.1</span>
        </div>

        <ViewSwitcher />

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <TemplateSwitcher />
          <ConnectionDot />
        </div>
      </div>

      {/* Main */}
      <div style={s.main}>
        <div style={{ ...s.sidebar, background: t.panelBg, borderRightColor: t.panelBorder }}>
          <SearchBar />
          <MemoryPanel loading={loading} onStore={() => setShowStoreModal(true)} />
        </div>

        <div style={s.canvas}>
          {loading && records.length === 0 ? (
            <div style={{ ...s.loadingOverlay, background: t.rootBg }}>
              <div style={{ ...s.spinner, borderColor: t.panelBorder, borderTopColor: t.accent }} />
              <div style={{ ...s.loadingText, color: t.textMuted }}>Loading neural graph…</div>
            </div>
          ) : (
            <NeuralCanvas />
          )}
        </div>

        <div style={{ ...s.inspector, background: t.panelBg, borderLeftColor: t.panelBorder }}>
          <NeuronInspector />
        </div>
      </div>

      <StatusBar />

      {showStoreModal && (
        <StoreMemoryModal
          onClose={() => setShowStoreModal(false)}
          onStored={(record) => {
            setShowStoreModal(false);
            useMemoryStore.getState().addRecord(record);
          }}
        />
      )}
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

const s = {
  root: { display: 'flex', flexDirection: 'column' as const, width: '100%', height: '100%', overflow: 'hidden' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 16px', height: '46px', borderBottom: '1px solid',
    flexShrink: 0, gap: '12px',
  },
  logo: { display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 },
  logoIcon: { fontSize: '16px' },
  logoText: { fontSize: '13px', fontWeight: 700, letterSpacing: '-0.02em' },
  logoBadge: { fontSize: '10px', padding: '1px 5px', borderRadius: '4px' },
  main: { flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 },
  sidebar: { width: '260px', flexShrink: 0, display: 'flex', flexDirection: 'column' as const, borderRight: '1px solid', overflow: 'hidden' },
  canvas: { flex: 1, position: 'relative' as const, overflow: 'hidden', minWidth: 0, height: '100%' },
  inspector: { width: '252px', flexShrink: 0, borderLeft: '1px solid', overflow: 'hidden', display: 'flex', flexDirection: 'column' as const },
  loadingOverlay: { position: 'absolute' as const, inset: 0, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: '12px' },
  spinner: { width: '28px', height: '28px', border: '2px solid', borderRadius: '50%' },
  loadingText: { fontSize: '12px' },
} as const;
