import type { ReactNode } from 'react';
import type { MemoryRecord } from '../../store/memoryStore.js';
import { toPlainText } from '../../lib/plainText.js';
import { formatDateTime, formatRelative } from '../../lib/dates.js';
import './memory.css';

export const TYPE_NAME: Record<MemoryRecord['type'], string> = {
  semantic: 'Semantic',
  episodic: 'Episodic',
  procedural: 'Procedural',
};

/** Memories the reflection engine wrote, drawn hollow wherever a type is. */
export function isReflection(record: Pick<MemoryRecord, 'source'>): boolean {
  return record.source === 'reflection';
}

/**
 * A memory's type as a shape as well as a colour (circle, triangle, square),
 * so colour never carries it alone. Hollow for a machine-written reflection.
 */
export function TypeMark({ type, hollow = false, size = 13 }: { type: MemoryRecord['type']; hollow?: boolean; size?: number }) {
  return (
    <svg className="mm-mark" data-type={type} data-hollow={hollow} width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      {type === 'semantic' ? (
        <circle cx="6" cy="6" r="4.4" />
      ) : type === 'episodic' ? (
        <path d="M6 1.2l5 9.2H1z" />
      ) : (
        <rect x="1.8" y="1.8" width="8.4" height="8.4" />
      )}
    </svg>
  );
}

/** Words too common to be worth marking in a result. */
const STOPWORDS = new Set(['the', 'and', 'for', 'how', 'what', 'why', 'who', 'when', 'where', 'does', 'did', 'with', 'from', 'that', 'this', 'are', 'was', 'you', 'your', 'can', 'not', 'into', 'about']);

/** Marks where the typed words (three letters or more) start a word in the text. */
export function highlight(text: string, query: string): ReactNode {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.length === 0) return text;
  const parts = text.split(new RegExp(`\\b(${words.join('|')})`, 'gi'));
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}

/** Enough text for two lines at any sheet width; CSS does the clamping. */
const ROW_TEXT_MAX = 240;

/**
 * One memory in a list: its text (two lines), then project, source and age.
 * A button: opening it is the only thing a row does.
 */
export function MemoryRow({
  record,
  query = '',
  project,
  current,
  onOpen,
}: {
  record: MemoryRecord;
  query?: string;
  /** The project's name, when the store has projects to tell apart. */
  project?: string;
  current?: boolean;
  onOpen: (id: string) => void;
}) {
  const text = toPlainText(record.content).slice(0, ROW_TEXT_MAX);
  return (
    <button type="button" className="mm-row" data-id={record.id} aria-current={current || undefined} onClick={() => onOpen(record.id)}>
      <TypeMark type={record.type} hollow={isReflection(record)} />
      <span className="mm-row-main">
        <span className="mm-row-t">{highlight(text, query)}</span>
        <span className="mm-row-m">
          <span className="at-sr">{TYPE_NAME[record.type]}.</span>
          {project && <span className="mm-proj">{project}</span>}
          {record.source && <span>{record.source}</span>}
          <span title={formatDateTime(record.createdAt)}>{formatRelative(record.createdAt)}</span>
        </span>
      </span>
    </button>
  );
}
