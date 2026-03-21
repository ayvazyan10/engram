import { VIEWS, useViewStore } from '../../store/viewStore.js';

export default function ViewSwitcher() {
  const { activeViewId, setView } = useViewStore();

  return (
    <div style={styles.wrap}>
      {VIEWS.map((v) => {
        const active = v.id === activeViewId;
        return (
          <button
            key={v.id}
            style={{ ...styles.btn, ...(active ? styles.btnActive : {}) }}
            onClick={() => setView(v.id)}
            title={v.description}
          >
            <span style={styles.icon}>{v.icon}</span>
            <span style={{ ...styles.label, ...(active ? styles.labelActive : {}) }}>{v.name}</span>
          </button>
        );
      })}
    </div>
  );
}

const styles = {
  wrap: {
    display: 'flex',
    gap: '2px',
    background: '#060e1e',
    border: '1px solid #0f2040',
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
  btnActive: {
    background: '#0f2040',
  },
  icon: {
    fontSize: '12px',
    color: '#6366f1',
    lineHeight: 1,
  },
  label: {
    fontSize: '11px',
    fontWeight: 500,
    color: '#334155',
    letterSpacing: '0.01em',
  },
  labelActive: {
    color: '#94a3b8',
  },
} as const;
