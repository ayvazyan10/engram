import PlateChooser from './PlateChooser.js';
import { useDashboardStore, type ViewMode } from '../../store/dashboardStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { GLYPH, TYPE, SPACE } from '../../lib/tokens.js';
import { segmentBase, segmentState, trackStyle } from './segmented.js';

/**
 * The header's navigation: which surface, and — on the plate surface — which
 * plate.
 *
 * The first tab used to say "3D", which was true when the surface behind it
 * was one WebGL scene wearing three art directions. It is five plates now:
 * two 3D, one 2D, two hybrid. A control labelled "3D" would be lying about
 * three of the five, so it says "Plates" — the word the whole system already
 * uses (the contract, the token layer, the box itself), and the one label that
 * stays true whatever a plate is drawn with.
 *
 * The five are not a fourth segmented track. They carry a sentence each, and
 * five names plus five sentences do not fit beside four mode tabs and a
 * template switcher — see PlateChooser for what they get instead.
 *
 * L6: icons come from the registry. '◎' (GLYPH.confidence) and '◈'
 * (GLYPH.pattern) used to be re-typed here for the first and last tab — the
 * primary navigation wearing two glyphs that mean something else a panel away.
 * The Plates tab shares `panePlate` with the mobile tab bar's plate pane on
 * purpose: same thing.
 */
const MODE_TABS: { id: ViewMode; label: string; icon: string }[] = [
  { id: '3d', label: 'Plates', icon: GLYPH.panePlate },
  { id: 'timeline', label: 'Timeline', icon: GLYPH.viewTimeline },
  { id: 'analytics', label: 'Analytics', icon: GLYPH.viewAnalytics },
  { id: 'reflections', label: 'Reflections', icon: GLYPH.viewReflections },
];

export default function ViewSwitcher() {
  const { viewMode, setViewMode } = useDashboardStore();
  const t = useTemplateStore((s) => s.activeTemplate);

  return (
    <div style={s.container}>
      <div style={trackStyle(t)} role="group" aria-label="View">
        {MODE_TABS.map((tab) => {
          const active = tab.id === viewMode;
          return (
            <button
              key={tab.id}
              className="ec-hover-tint"
              style={{ ...segmentBase, ...segmentState(t, active) }}
              onClick={() => setViewMode(tab.id)}
              title={tab.label}
              aria-pressed={active}
            >
              <span aria-hidden="true" style={s.modeIcon}>{tab.icon}</span>
              <span className="ec-switcher-label">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {viewMode === '3d' && <PlateChooser />}
    </div>
  );
}

const s = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE.sm,
    flexWrap: 'wrap' as const,
    minWidth: 0,
  },
  modeIcon: {
    fontSize: TYPE.sm,
    lineHeight: 1,
    opacity: 0.85,
  },
} as const;
