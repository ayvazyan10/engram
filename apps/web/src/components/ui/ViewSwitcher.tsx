import { VIEWS, useViewStore } from '../../store/viewStore.js';
import { useDashboardStore, type ViewMode } from '../../store/dashboardStore.js';
import { useTemplateStore } from '../../store/templateStore.js';

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
              style={{
                ...s.modeBtn,
                ...(active ? { background: t.accent + '20', color: t.accent } : { color: t.textMuted }),
              }}
              onClick={() => setViewMode(tab.id)}
              title={tab.label}
            >
              <span style={s.modeIcon}>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* 3D sub-views only visible in 3D mode */}
      {viewMode === '3d' && (
        <div style={{ ...s.wrap, background: t.inputBg, borderColor: t.panelBorder }}>
          {VIEWS.map((v) => {
            const active = v.id === activeViewId;
            return (
              <button
                key={v.id}
                style={{
                  ...s.btn,
                  ...(active ? { background: t.accent + '18' } : {}),
                }}
                onClick={() => setView(v.id)}
                title={v.description}
              >
                <span style={{ ...s.icon, color: t.accent }}>{v.icon}</span>
                <span style={{ ...s.label, color: active ? t.textSecondary : t.textMuted }}>
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
  },
  modeTabs: {
    display: 'flex',
    gap: '2px',
    border: '1px solid',
    borderRadius: '8px',
    padding: '2px',
  },
  modeBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 10px',
    background: 'transparent',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 500,
    transition: 'background 0.15s, color 0.15s',
    whiteSpace: 'nowrap' as const,
  },
  modeIcon: {
    fontSize: '11px',
    lineHeight: 1,
  },
  wrap: {
    display: 'flex',
    gap: '2px',
    border: '1px solid',
    borderRadius: '8px',
    padding: '2px',
  },
  btn: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '4px 10px',
    background: 'transparent',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background 0.15s',
    whiteSpace: 'nowrap' as const,
  },
  icon: {
    fontSize: '12px',
    lineHeight: 1,
  },
  label: {
    fontSize: '11px',
    fontWeight: 500,
    letterSpacing: '0.01em',
  },
} as const;
