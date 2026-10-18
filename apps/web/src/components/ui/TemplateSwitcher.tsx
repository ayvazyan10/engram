import { useTemplateStore, TEMPLATES, type UITemplate } from '../../store/templateStore.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { withAlpha } from '../../lib/tokens.js';
import { segmentBase, segmentState, trackStyle } from './segmented.js';

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
  // did not reach. It is the same track as the view switcher now.
  if (compact) {
    const index = TEMPLATES.findIndex((t) => t.id === activeTemplate.id);
    const next = TEMPLATES[(index + 1) % TEMPLATES.length]!;
    return (
      <div style={trackStyle(activeTemplate)}>
        <button
          className="ec-hover-tint"
          style={{ ...segmentBase, ...segmentState(activeTemplate, true) }}
          onClick={() => setTemplate(next.id)}
          title={`Theme: ${activeTemplate.name} — switch to ${next.name}`}
          aria-label={`Theme: ${activeTemplate.name}. Switch to ${next.name}`}
        >
          <Dot template={activeTemplate} active />
          <span className="ec-template-label">{activeTemplate.name}</span>
        </button>
      </div>
    );
  }

  return (
    <div style={trackStyle(activeTemplate)} role="group" aria-label="Theme">
      {TEMPLATES.map((t) => {
        const active = t.id === activeTemplate.id;
        return (
          <button
            key={t.id}
            className="ec-hover-tint"
            style={{ ...segmentBase, ...segmentState(activeTemplate, active) }}
            onClick={() => setTemplate(t.id)}
            title={t.name}
            aria-pressed={active}
          >
            <Dot template={t} active={active} />
            <span className="ec-template-label">{t.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The swatch: each template's own accent, so the three read as what they
 *  switch to. The active one wears a soft ring instead of a glow. */
function Dot({ template, active }: { template: UITemplate; active: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 8, height: 8, borderRadius: '50%',
        background: template.accent,
        display: 'inline-block',
        flexShrink: 0,
        boxShadow: active ? `0 0 0 2px ${withAlpha(template.accent, 0.28)}` : 'none',
      }}
    />
  );
}
