import { useTemplateStore, TEMPLATES } from '../../store/templateStore.js';

export default function TemplateSwitcher() {
  const { activeTemplate, setTemplate } = useTemplateStore();

  return (
    <div style={styles.wrapper}>
      {TEMPLATES.map((t) => {
        const active = t.id === activeTemplate.id;
        return (
          <button
            key={t.id}
            style={{
              ...styles.btn,
              background: active ? activeTemplate.cardBg : 'transparent',
              color: active ? activeTemplate.textPrimary : activeTemplate.textMuted,
              borderColor: active ? activeTemplate.panelBorder : 'transparent',
            }}
            onClick={() => setTemplate(t.id)}
            title={t.name}
          >
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: t.accent,
              display: 'inline-block',
              boxShadow: active ? `0 0 6px ${t.accentGlow}` : 'none',
            }} />
            <span style={{ fontSize: '10px', fontWeight: active ? 600 : 400 }}>{t.name}</span>
          </button>
        );
      })}
    </div>
  );
}

const styles = {
  wrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    padding: '2px',
    borderRadius: '8px',
    border: '1px solid #1a1a1a',
    background: '#050505',
  },
  btn: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '4px 10px',
    border: '1px solid',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap' as const,
    fontFamily: 'inherit',
  },
} as const;
