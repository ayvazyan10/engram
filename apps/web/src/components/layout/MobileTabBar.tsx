import type { UITemplate } from '../../store/templateStore.js';
import { GLYPH, TYPE, withAlpha } from '../../lib/tokens.js';

export type MobilePane = 'list' | 'canvas' | 'inspector';

// L6: from the registry, not hand-picked here. The previous '⬡'/'◈' pair
// was `GLYPH.concept` and `GLYPH.pattern` — the same two glyphs a timeline card
// and a reflection badge use for something else entirely.
const TABS: { id: MobilePane; label: string; icon: string }[] = [
  { id: 'list', label: 'Memories', icon: GLYPH.paneMemories },
  { id: 'canvas', label: 'Graph', icon: GLYPH.paneGraph },
  { id: 'inspector', label: 'Inspect', icon: GLYPH.paneInspect },
];

interface Props {
  pane: MobilePane;
  onChange: (pane: MobilePane) => void;
  t: UITemplate;
}

/**
 * Below ~900px (V3) AppLayout can no longer afford a fixed 260px sidebar +
 * fluid canvas + fixed 252px inspector side by side — at 768px that leaves
 * ~256px for the 3D scene, and at 320-375px the two fixed columns alone
 * exceed the viewport. This replaces the 3-column row with one full-width
 * pane at a time, switched here instead of via CSS `display:none` (which
 * would still mount/measure the hidden panes at their desktop widths).
 */
export default function MobileTabBar({ pane, onChange, t }: Props) {
  return (
    <nav className="ec-mobile-tabbar" style={{ background: t.panelBg, borderTopColor: t.panelBorder }} aria-label="Panel switcher">
      {TABS.map((tab) => {
        const active = tab.id === pane;
        return (
          <button
            key={tab.id}
            className="ec-mobile-tab ec-hover-tint"
            style={{ color: active ? t.accent : t.textMuted }}
            onClick={() => onChange(tab.id)}
            aria-current={active}
          >
            <span style={{ fontSize: TYPE.xl, lineHeight: 1 }}>{tab.icon}</span>
            <span style={{ fontSize: TYPE.micro, fontWeight: active ? 600 : 400 }}>{tab.label}</span>
            {active && <span style={{ position: 'absolute', bottom: 0, width: 20, height: 2, borderRadius: 1, background: t.accent, boxShadow: `0 0 6px ${withAlpha(t.accent, 0.6)}` }} />}
          </button>
        );
      })}
    </nav>
  );
}
