import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useMemoryStore, type ProjectFilter } from '../../store/memoryStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { useServerStats } from '../../lib/serverStats.js';
import { projectLabel } from '../../lib/projects.js';
import { RADIUS, SPACE, TYPE, WEIGHT, withAlpha } from '../../lib/tokens.js';

interface Choice {
  value: ProjectFilter;
  label: string;
  count: number;
  /** The second line: a project's full path, or what Global means. */
  detail?: string;
}

/**
 * Which project's memories Home lists: All, Global, then each project by how
 * many memories it holds. Picking one sets the store's `projectFilter`, and
 * AppLayout reloads the list for it. Hidden while the store has a single
 * bucket — there is nothing to choose between.
 *
 * A drop-down of plain rows rather than a native <select>: each row carries
 * its count and, for a project, the full path, which tells two projects with
 * one folder name apart on a phone, where there is no tooltip.
 */
export default function ProjectPicker() {
  const t = useTemplateStore((s) => s.activeTemplate);
  const stats = useServerStats();
  const filter = useMemoryStore((s) => s.projectFilter);
  const setFilter = useMemoryStore((s) => s.setProjectFilter);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelId = useId();

  const buckets = stats?.byNamespace ?? [];
  const known = buckets.map((b) => b.namespace);
  const global = buckets.find((b) => b.namespace === null);
  const choices: Choice[] = [
    { value: undefined, label: 'All projects', count: stats?.total ?? 0 },
    ...(global ? [{ value: null, label: 'Global', count: global.count, detail: 'Shared by every project' }] : []),
    ...buckets
      .filter((b) => b.namespace !== null)
      .map((b) => ({ value: b.namespace, label: projectLabel(b.namespace, known), count: b.count, detail: b.namespace ?? undefined }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  ];
  const current = choices.find((c) => c.value === filter);
  const currentLabel = current?.label ?? projectLabel(filter, known);

  // A pointer anywhere outside closes, before whatever was under it reacts.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Opening lands on the current choice.
  const selectedIndex = Math.max(0, choices.findIndex((c) => c.value === filter));
  useEffect(() => {
    if (open) optionRefs.current[selectedIndex]?.focus();
  }, [open, selectedIndex]);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  // Escape is marked handled so AppLayout's window-level Escape does not
  // also clear the selected memory (as in PlateChooser).
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return setOpen(true);
      const focused = optionRefs.current.findIndex((el) => el === document.activeElement);
      const next = (focused + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
      optionRefs.current[next]?.focus();
    }
  };

  // A filter left over from a richer census stays reachable: the control
  // shows while a choice is active even if the buckets have since collapsed.
  if (buckets.length < 2 && filter === undefined) return null;

  return (
    <div ref={wrapRef} style={s.wrap} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="ec-hover-tint"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Project: ${currentLabel}`}
        title={typeof filter === 'string' ? filter : undefined}
        onClick={() => setOpen((v) => !v)}
        style={{ ...s.trigger, color: t.textSecondary, borderColor: t.panelBorder }}
      >
        <span style={s.ellipsis}>{currentLabel}</span>
        <svg viewBox="0 0 16 16" fill="none" style={s.caret} aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-label="Show memories from"
          style={{ ...s.panel, background: t.cardBg, borderColor: t.panelBorder }}
        >
          {choices.map((choice, i) => {
            const active = choice.value === filter;
            return (
              <button
                key={choice.value ?? String(choice.value)}
                ref={(el) => {
                  optionRefs.current[i] = el;
                }}
                type="button"
                className="ec-hover-tint"
                aria-pressed={active}
                title={choice.detail}
                onClick={() => {
                  setFilter(choice.value);
                  close();
                }}
                style={{ ...s.option, background: active ? withAlpha(t.accent, 0.1) : 'transparent' }}
              >
                <span style={s.optionHead}>
                  <span style={{ ...s.ellipsis, color: t.textPrimary, fontWeight: active ? WEIGHT.semibold : WEIGHT.medium }}>
                    {choice.label}
                  </span>
                  <span className="ec-tabular" style={{ color: t.textMuted }}>{choice.count}</span>
                </span>
                {choice.detail && (
                  <span className="ec-wrap-anywhere" style={{ ...s.detail, color: t.textMuted }}>{choice.detail}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const s = {
  wrap: { position: 'relative' as const, minWidth: 0 },
  trigger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: SPACE['2xs'],
    maxWidth: 200,
    minHeight: 28,
    padding: `0 ${SPACE.sm} 0 ${SPACE.md}`,
    background: 'transparent',
    border: '1px solid',
    borderRadius: RADIUS.sm,
    fontSize: TYPE.sm,
    fontWeight: WEIGHT.medium,
    fontFamily: 'inherit',
  },
  caret: { width: 12, height: 12, flexShrink: 0 },
  ellipsis: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  panel: {
    position: 'absolute' as const,
    top: `calc(100% + ${SPACE.xs})`,
    right: 0,
    zIndex: 20,
    width: 'min(320px, calc(100vw - 32px))',
    maxHeight: '60vh',
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: SPACE['3xs'],
    padding: SPACE['2xs'],
    border: '1px solid',
    borderRadius: RADIUS.md,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
  },
  option: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: SPACE['3xs'],
    width: '100%',
    padding: `${SPACE.xs} ${SPACE.sm}`,
    border: 'none',
    borderRadius: RADIUS.sm,
    textAlign: 'left' as const,
    fontSize: TYPE.base,
    fontFamily: 'inherit',
  },
  optionHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: SPACE.md, minWidth: 0 },
  detail: { fontSize: TYPE.sm, lineHeight: 1.4 },
} as const;
