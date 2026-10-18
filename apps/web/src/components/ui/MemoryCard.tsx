import type { MemoryRecord } from '../../store/memoryStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { RADIUS, SPACE, TYPE, TYPE_COLORS, WEIGHT, withAlpha } from '../../lib/tokens.js';
import { toPlainText } from '../../lib/plainText.js';
import { formatDateTime, formatRelative } from '../../lib/dates.js';
import { parseTagLabel } from '../../lib/tagLabel.js';
import { ProjectTag, TypeTag } from './DataMark.js';

/** How many tags a card shows before it says "+n". */
const MAX_TAGS = 3;

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * One memory as a readable card: the content itself (two lines), what kind
 * of memory it is as a word, where it came from, how long ago, and its tags.
 * Used by Home's list and by the onboarding step that shows the first memory
 * arriving. Clicking it selects the memory, which opens the inspector.
 */
export default function MemoryCard({
  record,
  selected,
  onSelect,
  project,
}: {
  record: MemoryRecord;
  selected: boolean;
  onSelect: (id: string) => void;
  /** The project's name on screen. Left out when the store has no projects,
   *  so a store of global memories only gets no extra label. */
  project?: string;
}) {
  const t = useTemplateStore((s) => s.activeTemplate);
  const tags = parseTags(record.tags);
  const extra = tags.length - MAX_TAGS;
  const typeColor = TYPE_COLORS[record.type] ?? t.textMuted;

  return (
    <button
      type="button"
      className="ec-hover-tint"
      aria-pressed={selected}
      onClick={() => onSelect(record.id)}
      style={{
        ...s.card,
        background: selected ? withAlpha(t.accent, 0.08) : t.cardBg,
        borderColor: selected ? t.accent : t.panelBorder,
        // The left edge is the type's mark, as on the memory list's rows.
        // A border rather than an inset shadow: .ec-hover-tint paints its
        // hover as a shadow, and an inline one would swallow it.
        borderLeft: `3px solid ${withAlpha(typeColor, selected ? 1 : 0.6)}`,
      }}
    >
      <p style={{ ...s.content, color: t.textPrimary }}>{toPlainText(record.content)}</p>
      <div style={{ ...s.meta, color: t.textMuted }}>
        <TypeTag type={record.type} />
        {project && <ProjectTag namespace={record.namespace} label={project} style={s.project} />}
        {record.source && <span style={s.source}>{record.source}</span>}
        <span className="ec-tabular" style={s.date} title={formatDateTime(record.createdAt)}>
          {formatRelative(record.createdAt)}
        </span>
      </div>
      {tags.length > 0 && (
        <div style={s.tags}>
          {tags.slice(0, MAX_TAGS).map((tag) => {
            const label = parseTagLabel(tag);
            return (
              <span key={tag} title={tag} style={{ ...s.tag, color: t.textSecondary, borderColor: t.panelBorder }}>
                {label.prefix}
                {label.value}
              </span>
            );
          })}
          {extra > 0 && <span style={{ ...s.more, color: t.textMuted }}>+{extra}</span>}
        </div>
      )}
    </button>
  );
}

const s = {
  card: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: SPACE.sm,
    width: '100%',
    minWidth: 0,
    padding: `${SPACE.md} ${SPACE.lg} ${SPACE.md} ${SPACE.lg}`,
    border: '1px solid',
    borderRadius: RADIUS.md,
    textAlign: 'left' as const,
    fontFamily: 'inherit',
  },
  content: {
    margin: 0,
    fontSize: TYPE.md,
    lineHeight: 1.45,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
    overflow: 'hidden',
    overflowWrap: 'anywhere' as const,
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE.sm,
    minWidth: 0,
    fontSize: TYPE.sm,
  },
  project: { maxWidth: '45%', flexShrink: 1 },
  source: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  date: { marginLeft: 'auto', flexShrink: 0, whiteSpace: 'nowrap' as const },
  tags: { display: 'flex', flexWrap: 'wrap' as const, gap: SPACE['2xs'], minWidth: 0 },
  tag: {
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontSize: TYPE.sm,
    fontWeight: WEIGHT.regular,
    lineHeight: 1.4,
    padding: `0 ${SPACE.xs}`,
    border: '1px solid',
    borderRadius: RADIUS.tight,
  },
  more: { fontSize: TYPE.sm, lineHeight: 1.6 },
} as const;
