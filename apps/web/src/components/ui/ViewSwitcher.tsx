import { VIEWS, useViewStore } from '../../store/viewStore.js';
import { useDashboardStore, type ViewMode } from '../../store/dashboardStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { RADIUS, TYPE, withAlpha } from '../../lib/tokens.js';

const MODE_TABS: { id: ViewMode; label: string; icon: string }[] = [
  { id: '3d', label: '3D', icon: '◎' },
  { id: 'timeline', label: 'Timeline', icon: '⏤' },
  { id: 'analytics', label: 'Analytics', icon: '▧' },
  { id: 'reflections', label: 'Reflections', icon: '◈' },
];

export default function ViewSwitcher() {
  const { activeViewId, setView } = useViewStore();
  const { viewMode, setViewMode } = useDashboardStore();
  const t = useTemplateStore((s) => s.activeTemplate);

  return (
    <div style={s.container}>
      {/* Mode tabs */}
      <div style={{ ...s.modeTabs, background: t.inputBg, borderColor: t.panelBorder }}>
        {MODE_TABS.map((tab) => {
          const active = tab.id === viewMode;
          return (
            <button
              key={tab.id}
              className="ec-hover-tint"
              style={{
                ...s.modeBtn,
                ...(active ? { background: withAlpha(t.accent, 0.13), color: t.accent } : { color: t.textMuted }),
              }}
              onClick={() => setViewMode(tab.id)}
              title={tab.label}
            >
              <span style={s.modeIcon}>{tab.icon}</span>
              <span className="ec-switcher-label">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* The 3D sub-views. These are framings of ONE layout now, not five
          different scatter functions — see store/viewStore.ts. Nebula and
          Galaxy were removed there, and this list follows VIEWS rather than
          naming them, so it cannot fall out of step. */}
      {viewMode === '3d' && (
        <div style={{ ...s.wrap, background: t.inputBg, borderColor: t.panelBorder }}>
          {VIEWS.map((v) => {
            const active = v.id === activeViewId;
            return (
              <button
                key={v.id}
                className="ec-hover-tint"
                style={{
                  ...s.btn,
                  ...(active ? { background: withAlpha(t.accent, 0.09) } : {}),
                }}
                onClick={() => setView(v.id)}
                title={v.description}
                aria-pressed={active}
              >
                <span style={{ ...s.icon, color: t.accent }}>{v.icon}</span>
                <span className="ec-switcher-label" style={{ ...s.label, color: active ? t.textSecondary : t.textMuted }}>
                  {v.name}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const s = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap' as const,
  },
  modeTabs: {
    display: 'flex',
    gap: '2px',
    border: '1px solid',
    borderRadius: RADIUS.sm,
    padding: '2px',
  },
  modeBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 10px',
    background: 'transparent',
    border: 'none',
    borderRadius: RADIUS.tight,
    fontSize: TYPE.sm,
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
  },
  modeIcon: {
    fontSize: TYPE.sm,
    lineHeight: 1,
  },
  wrap: {
    display: 'flex',
    gap: '2px',
    border: '1px solid',
    borderRadius: RADIUS.sm,
    padding: '2px',
  },
  btn: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '4px 10px',
    background: 'transparent',
    border: 'none',
    borderRadius: RADIUS.tight,
    whiteSpace: 'nowrap' as const,
  },
  icon: {
    fontSize: TYPE.base,
    lineHeight: 1,
  },
  label: {
    fontSize: TYPE.sm,
    fontWeight: 500,
    letterSpacing: '0.01em',
  },
} as const;
