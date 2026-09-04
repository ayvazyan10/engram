import { useTemplateStore, TEMPLATES, type UITemplate } from '../../store/templateStore.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { RADIUS, SPACE, TYPE } from '../../lib/tokens.js';

/**
 * M12: the shared `.ec-switcher-label` rule hides switcher labels below
 * 860px, which left this control as three anonymous 8px dots — a dot of the
 * template's own accent colour names nothing, and the only label left was a
 * `title`, which touch never shows. It uses its own label class (not hidden)
 * and collapses to a single *named* button below 640px, where three labelled
 * buttons genuinely do not fit next to the view switcher.
 */
const COMPACT_QUERY = '(max-width: 640px)';

export default function TemplateSwitcher() {
  const { activeTemplate, setTemplate } = useTemplateStore();
  const compact = useMediaQuery(COMPACT_QUERY);

  // M11: was `border: '1px solid #1a1a1a'` / `background: '#050505'` — Mono's
  // own values, hardcoded. The theme control was the one control the themes
  // did not reach.
  const wrapperStyle = {
    ...styles.wrapper,
    borderColor: activeTemplate.panelBorder,
    background: activeTemplate.rootBg,
  };

  if (compact) {
    const index = TEMPLATES.findIndex((t) => t.id === activeTemplate.id);
    const next = TEMPLATES[(index + 1) % TEMPLATES.length]!;
    return (
      <div style={wrapperStyle}>
        <button
          className="ec-hover-tint"
          style={{
            ...styles.btn,
            background: activeTemplate.cardBg,
            color: activeTemplate.textPrimary,
            borderColor: activeTemplate.panelBorder,
          }}
          onClick={() => setTemplate(next.id)}
          title={`Theme: ${activeTemplate.name} — switch to ${next.name}`}
        >
          <Dot template={activeTemplate} active />
          <span className="ec-template-label" style={{ fontSize: TYPE.xs, fontWeight: 600 }}>{activeTemplate.name}</span>
        </button>
      </div>
    );
  }

  return (
    <div style={wrapperStyle}>
      {TEMPLATES.map((t) => {
        const active = t.id === activeTemplate.id;
        return (
          <button
            key={t.id}
            className="ec-hover-tint"
            style={{
              ...styles.btn,
              background: active ? activeTemplate.cardBg : 'transparent',
              color: active ? activeTemplate.textPrimary : activeTemplate.textMuted,
              borderColor: active ? activeTemplate.panelBorder : 'transparent',
            }}
            onClick={() => setTemplate(t.id)}
            title={t.name}
          >
            <Dot template={t} active={active} />
            <span className="ec-template-label" style={{ fontSize: TYPE.xs, fontWeight: active ? 600 : 400 }}>{t.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function Dot({ template, active }: { template: UITemplate; active: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 8, height: 8, borderRadius: '50%',
        background: template.accent,
        display: 'inline-block',
        flexShrink: 0,
        boxShadow: active ? `0 0 6px ${template.accentGlow}` : 'none',
      }}
    />
  );
}

const styles = {
  wrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE['3xs'],
    padding: SPACE['3xs'],
    borderRadius: RADIUS.sm,
    border: '1px solid',
  },
  btn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xs,
    // M6: the button was 22px tall, under the 24x24 WCAG 2.2 target minimum.
    minHeight: 24,
    padding: `${SPACE['2xs']} ${SPACE.md}`,
    border: '1px solid',
    borderRadius: RADIUS.tight,
    whiteSpace: 'nowrap' as const,
    fontFamily: 'inherit',
  },
} as const;
