import PlateChooser from './PlateChooser.js';
import { useDashboardStore, type ViewMode } from '../../store/dashboardStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { COMPACT_QUERY, useMediaQuery } from '../../hooks/useMediaQuery.js';
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
 *
 * Home comes first and is the default view: a person opening the dashboard
 * is looking for their memories, and the plates are one click away.
 *
 * Labels always show, at every width (styles/global.css hides the icons
 * first). On a compact viewport the plate chooser is not in the header at
 * all: it sits on the plate surface itself (PlateSurface), which keeps the
 * header to one row.
 */
const MODE_TABS: { id: ViewMode; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: GLYPH.viewHome },
  { id: '3d', label: 'Plates', icon: GLYPH.panePlate },
  { id: 'timeline', label: 'Timeline', icon: GLYPH.viewTimeline },
  { id: 'analytics', label: 'Analytics', icon: GLYPH.viewAnalytics },
  { id: 'reflections', label: 'Reflections', icon: GLYPH.viewReflections },
];

export default function ViewSwitcher() {
  const { viewMode, setViewMode } = useDashboardStore();
  const t = useTemplateStore((s) => s.activeTemplate);
  const isCompact = useMediaQuery(COMPACT_QUERY);

  return (
    <div style={s.container}>
      <div className="ec-tabs" style={{ ...trackStyle(t), minWidth: 0 }} role="group" aria-label="View">
        {MODE_TABS.map((tab) => {
          const active = tab.id === viewMode;
          return (
            <button
              key={tab.id}
              className="ec-hover-tint"
              style={{ ...segmentBase, ...segmentState(t, active) }}
              onClick={() => setViewMode(tab.id)}
              aria-pressed={active}
            >
              <span aria-hidden="true" className="ec-switcher-icon" style={s.modeIcon}>{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {viewMode === '3d' && !isCompact && <PlateChooser />}
    </div>
  );
}

const s = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE.sm,
    flex: '0 1 auto',
    minWidth: 0,
  },
  modeIcon: {
    fontSize: TYPE.sm,
    lineHeight: 1,
    opacity: 0.85,
  },
} as const;
