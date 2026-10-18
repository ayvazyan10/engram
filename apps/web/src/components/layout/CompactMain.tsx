import { useTemplateStore } from '../../store/templateStore.js';
import MemoryPanel from '../ui/MemoryPanel.js';
import SearchBar from '../ui/SearchBar.js';
import NeuronInspector from '../ui/NeuronInspector.js';
import PlateSurface from '../plates/PlateSurface.js';
import MobileTabBar, { type MobilePane } from './MobileTabBar.js';
import type { ObsData } from '../../lib/plate/contract.js';

/**
 * The compact shell, lifted out of AppLayout when the plate surface arrived
 * and pushed that file past its size budget. It is the same component, and it
 * still takes everything it needs as props — the desktop and compact shells
 * must render the same load state and the same plate, from one place that
 * owns both.
 */

interface CompactMainProps {
  pane: MobilePane;
  onPaneChange: (pane: MobilePane) => void;
  loading: boolean;
  loadError: string | null;
  loadMemories: () => void;
  onLoadMore: () => void;
  loadingMore: boolean;
  onStore: () => void;
  plateData: ObsData | null;
  plateError: string | null;
  onPlateRetry: () => void;
}

/** The plate-mode layout below ~900px (V3): one full-width pane at a time
 *  (list / plate / inspector), switched via MobileTabBar instead of the
 *  desktop's fixed 3-column row. */
export default function CompactMain({ pane, onPaneChange, loading, loadError, loadMemories, onLoadMore, loadingMore, onStore, plateData, plateError, onPlateRetry }: CompactMainProps) {
  const t = useTemplateStore((s) => s.activeTemplate);

  return (
    <div style={s.compactMain}>
      <div style={s.compactPaneArea}>
        {pane === 'list' && (
          <div className="ec-mobile-pane" style={{ background: t.panelBg, display: 'flex', flexDirection: 'column' }}>
            <SearchBar />
            <MemoryPanel loading={loading} error={loadError} onRetry={loadMemories} onStore={onStore} onLoadMore={onLoadMore} loadingMore={loadingMore} />
          </div>
        )}
        {pane === 'canvas' && (
          <div className="ec-mobile-pane" style={{ position: 'relative' }}>
            <PlateSurface data={plateData} error={plateError} onRetry={onPlateRetry} />
          </div>
        )}
        {pane === 'inspector' && (
          <div className="ec-mobile-pane" style={{ background: t.panelBg }}>
            <NeuronInspector />
          </div>
        )}
      </div>
      <MobileTabBar pane={pane} onChange={onPaneChange} t={t} />
    </div>
  );
}


const s = {
  compactMain: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0 },
  compactPaneArea: { flex: 1, overflow: 'hidden', minHeight: 0 },
} as const;
