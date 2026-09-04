import { useMemoryStore } from '../../store/memoryStore.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useTemplateStore, type UITemplate } from '../../store/templateStore.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { GLYPH, SPACE, STATUS, TYPE, TYPE_COLORS } from '../../lib/tokens.js';
import { DataDot } from './DataMark.js';
import { useServerStats } from '../../lib/serverStats.js';

/** H9: below this the bar keeps only what it can render on one 26px line —
 *  the total, the recall latency and the brand. The three type chips and the
 *  "nodes visible" segment are both available elsewhere (the sidebar's type
 *  pills, and the canvas itself), so they are what goes. */
const COMPACT_QUERY = '(max-width: 640px)';

export default function StatusBar() {
  const { neurons } = useNeuralStore();
  const { loadedCount, recallLatencyMs, currentContext } = useMemoryStore();
  const t = useTemplateStore((s) => s.activeTemplate);
  const stats = useServerStats();
  const compact = useMediaQuery(COMPACT_QUERY);

  // H6: two different quantities, and the bar no longer substitutes one for
  // the other. `stats.total` is every memory the server holds; `loadedCount`
  // is the page the sidebar has in hand, which the server caps at 200. The old
  // `stats?.total ?? totalCount` relabelled 200 loaded records as the store's
  // total for as long as the first census was in flight. Until it lands, say
  // what we actually know.
  const census = stats?.total ?? null;
  const countLabel = census !== null ? `${census} memories` : `${loadedCount} loaded`;
  const countTitle =
    census !== null
      ? `${census} stored memories`
      : `${loadedCount} memories loaded — the server's total is not in yet`;

  return (
    <div style={{ ...styles.bar, background: t.statusBg, borderTopColor: t.panelBorder, color: t.textMuted }}>
      <div style={styles.left}>
        {stats?.byType && !compact && (
          <>
            <Chip label="E" value={stats.byType['episodic'] ?? 0} color={TYPE_COLORS.episodic} title="Episodic memories" t={t} />
            <Chip label="S" value={stats.byType['semantic'] ?? 0} color={TYPE_COLORS.semantic} title="Semantic memories" t={t} />
            <Chip label="P" value={stats.byType['procedural'] ?? 0} color={TYPE_COLORS.procedural} title="Procedural memories" t={t} />
            <div style={{ ...styles.sep, background: t.panelBorder }} />
          </>
        )}
        <span className="ec-tabular" title={countTitle}>{countLabel}</span>
        {!compact && (
          <>
            <div style={{ ...styles.sep, background: t.panelBorder }} />
            <span className="ec-tabular">{neurons.length} nodes visible</span>
          </>
        )}
      </div>

      <div style={styles.center}>
        {currentContext && !compact && (
          <span className="ec-tabular" style={styles.contextHint} title={currentContext}>
            {GLYPH.contextLoaded} Context loaded — {currentContext.length} chars
          </span>
        )}
      </div>

      <div style={styles.right}>
        {recallLatencyMs !== null && (
          <>
            <span>recall</span>
            <span className="ec-tabular" style={{ ...styles.latency, color: recallLatencyMs < 100 ? STATUS.success : recallLatencyMs < 300 ? STATUS.warning : STATUS.danger }}>
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

/**
 * F2: the E/S/P letter used to BE the swatch — `style={{ color }}` on the
 * letter itself, which is exactly what the mark rules rule out. A 6px dot
 * carries the hue and the letter drops to ink, so the pair reads the same way
 * the donut legend and the scene key already do.
 */
function Chip({ label, value, color, title, t }: { label: string; value: number; color: string; title: string; t: UITemplate }) {
  return (
    <div style={styles.chip} title={title}>
      <DataDot color={color} size={6} />
      <span style={{ color: t.textSecondary, fontSize: TYPE.xs, fontWeight: 700 }}>{label}</span>
      <span className="ec-tabular" style={{ color: t.textSecondary, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    padding: `0 ${SPACE.lg}`,
    // H9: was a hard `height: 26px`. The left group measured 28px tall inside
    // it at 375px and 42px at 320px, where it overprinted the mobile tab bar.
    // minHeight lets the bar own its content; nowrap + overflow are the
    // backstop for anything that still can't fit on one line.
    minHeight: '26px',
    borderTop: '1px solid',
    fontSize: TYPE.sm,
    flexShrink: 0,
    gap: SPACE.sm,
    overflow: 'hidden',
    whiteSpace: 'nowrap' as const,
  },
  left: { display: 'flex', alignItems: 'center', gap: SPACE.sm, minWidth: 0, flexShrink: 0 },
  center: { flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0, overflow: 'hidden' },
  right: { display: 'flex', alignItems: 'center', gap: SPACE.sm, flexShrink: 0 },
  chip: { display: 'flex', alignItems: 'center', gap: SPACE['3xs'] },
  sep: { width: '1px', height: '12px', flexShrink: 0 },
  latency: { fontWeight: 600, fontSize: TYPE.sm },
  contextHint: { fontSize: TYPE.xs, cursor: 'default', overflow: 'hidden', textOverflow: 'ellipsis' },
  brand: { fontSize: TYPE.xs, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' as const },
} as const;
