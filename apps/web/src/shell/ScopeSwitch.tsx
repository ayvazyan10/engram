import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useMemoryStore, type ProjectFilter } from '../store/memoryStore.js';
import { useServerStats } from '../lib/serverStats.js';
import { projectLabel } from '../lib/projects.js';
import { Icon } from './icons.js';

export interface ScopeChoice {
  value: ProjectFilter;
  label: string;
  count: number;
  /** A project's full path, or what Global means. */
  detail?: string;
}

/** All, Global, then each project by how many memories it holds. */
export function useScopeChoices(): ScopeChoice[] {
  const stats = useServerStats();
  const buckets = stats?.byNamespace ?? [];
  const known = buckets.map((b) => b.namespace);
  const global = buckets.find((b) => b.namespace === null);
  return [
    { value: undefined, label: 'All projects', count: stats?.total ?? 0 },
    ...(global ? [{ value: null, label: 'Global', count: global.count, detail: 'Shared by every project' }] : []),
    ...buckets
      .filter((b) => b.namespace !== null)
      .map((b) => ({ value: b.namespace, label: projectLabel(b.namespace, known), count: b.count, detail: b.namespace ?? undefined }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  ];
}

/**
 * The project scope, global to every route: it filters the map, the lists and
 * search, and it no longer resets when leaving Home. Hidden while the store has
 * a single bucket, since there is nothing to choose between. `fixedNote` shows
 * the scope as a fact instead of a control, for a screen that cannot honour it.
 */
export default function ScopeSwitch({ fixedNote }: { fixedNote?: string }) {
  const choices = useScopeChoices();
  const filter = useMemoryStore((s) => s.projectFilter);
  const setFilter = useMemoryStore((s) => s.setProjectFilter);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const listId = useId();

  const selectedIndex = Math.max(0, choices.findIndex((c) => c.value === filter));
  const current = choices[selectedIndex];
  const currentLabel = choices.some((c) => c.value === filter) ? current!.label : projectLabel(filter, []);

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
  useEffect(() => {
    if (open) optionRefs.current[selectedIndex]?.focus();
  }, [open, selectedIndex]);

  // A filter left over from a richer census stays reachable: the control
  // shows while a choice is active even if the buckets have since collapsed.
  if (choices.length < 3 && filter === undefined) return null;

  if (fixedNote) {
    return (
      <p className="at-scope-fixed">
        <span className="at-scope" aria-hidden="true">
          <Icon name="layers" size={14} />
          All projects
        </span>
        {fixedNote}
      </p>
    );
  }

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const pick = (choice: ScopeChoice) => {
    setFilter(choice.value);
    close();
  };

  // Escape is marked handled so the shell's Escape leaves the selected memory alone.
  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const focused = optionRefs.current.findIndex((el) => el === document.activeElement);
    const move = (to: number) => {
      event.preventDefault();
      optionRefs.current[(to + choices.length) % choices.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(focused + 1);
    else if (event.key === 'ArrowUp') move(focused - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(choices.length - 1);
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (choices[focused]) pick(choices[focused]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') setOpen(false);
  };

  return (
    <div ref={wrapRef} className="at-scope-wrap">
      <button
        ref={buttonRef}
        type="button"
        className="at-scope"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Project: ${currentLabel}`}
        title={typeof filter === 'string' ? filter : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name="layers" size={14} />
        <span className="at-scope-label">{currentLabel}</span>
        <Icon name="chev" size={14} />
      </button>

      {open && (
        <ul id={listId} role="listbox" aria-label="Show memories from" className="at-pop at-scope-pop" onKeyDown={onListKey}>
          {choices.map((choice, i) => {
            const active = choice.value === filter;
            return (
              <li
                key={choice.value ?? String(choice.value)}
                ref={(el) => {
                  optionRefs.current[i] = el;
                }}
                role="option"
                aria-selected={active}
                tabIndex={-1}
                className="at-opt"
                title={choice.detail}
                onClick={() => pick(choice)}
              >
                <span className="at-opt-main">
                  {choice.label}
                  {choice.detail && <em>{choice.detail}</em>}
                </span>
                <small>{choice.count.toLocaleString('en-US')}</small>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
