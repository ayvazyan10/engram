import type { ReviewMemory } from '../../lib/api.js';
import { formatDayHeading, formatTimeOfDay } from '../../lib/dates.js';
import { toPlainText, truncateLabel } from '../../lib/plainText.js';
import { toHash, useRouteStore } from '../../shell/routeStore.js';

/** What a card's buttons can do. `dismiss` is each queue's "leave it be". */
export type Action = 'keepA' | 'keepB' | 'dismiss' | 'pin' | 'redact' | 'archive';

const TYPE_WORD: Record<ReviewMemory['type'], string> = {
  semantic: 'Semantic',
  episodic: 'Episodic',
  procedural: 'Procedural',
};

/** Type is a shape and a word, never colour alone: circle, triangle, square. */
export function TypeMark({ type }: { type: ReviewMemory['type'] }) {
  return (
    <span className="rv-type" data-type={type}>
      <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">
        {type === 'semantic' && <circle cx="5" cy="5" r="4.2" />}
        {type === 'episodic' && <path d="M5 .8L9.4 9H.6z" />}
        {type === 'procedural' && <rect x="1" y="1" width="8" height="8" rx="1" />}
      </svg>
      {TYPE_WORD[type] ?? type}
    </span>
  );
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** A row's one line: the concept, or the start of the text. */
export function titleOf(memory: ReviewMemory): string {
  return truncateLabel(toPlainText(memory.concept || memory.content) || 'Untitled memory', 90);
}

/** The memory opens over the current route through `?m=`. */
export function memoryHref(id: string): string {
  const route = useRouteStore.getState().route;
  return toHash({ ...route, params: { ...route.params, m: id } });
}

export function MemoryMeta({ memory, label }: { memory: ReviewMemory; label?: string }) {
  return (
    <header className="rv-meta">
      <TypeMark type={memory.type} />
      <span>
        {formatDayHeading(memory.createdAt)}, {formatTimeOfDay(memory.createdAt)}
      </span>
      <span>Importance {percent(memory.importance)}</span>
      <a className="rv-open" href={memoryHref(memory.id)}>
        Open{label ? <span className="at-sr"> {label}</span> : null}
      </a>
    </header>
  );
}

/** The keys a card answers to, shown as they are pressed. */
export function Keys({ keys }: { keys: [string, string][] }) {
  return (
    <p className="rv-keys" aria-label="Keyboard shortcuts">
      {keys.map(([key, what]) => (
        <span key={key}>
          <kbd>{key}</kbd> {what}
        </span>
      ))}
    </p>
  );
}

/** A button with its key beside the word. */
export function ActButton({
  label,
  keyName,
  onClick,
  kind = 'sec',
  disabled,
}: {
  label: string;
  keyName?: string;
  onClick: () => void;
  kind?: 'sec' | 'pri' | 'quiet';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`rv-btn ${kind}`}
      onClick={onClick}
      disabled={disabled}
      aria-keyshortcuts={keyName}
    >
      {label}
      {keyName && <kbd aria-hidden="true">{keyName}</kbd>}
    </button>
  );
}
