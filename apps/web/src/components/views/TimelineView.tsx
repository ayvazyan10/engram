import { useMemo } from 'react';
import { startOfDay } from 'date-fns';
import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { GLYPH, RADIUS, SPACE, STATUS, TYPE, TYPE_COLORS, withAlpha } from '../../lib/tokens.js';
import { safeParseISO, formatDayHeading, formatTimeOfDay, UNKNOWN_DATE_LABEL } from '../../lib/dates.js';
import { toPlainText } from '../../lib/plainText.js';
import { useServerStats } from '../../lib/serverStats.js';

const UNKNOWN_DATE_KEY = 'unknown';
const CARD_EXCERPT_LENGTH = 160;

interface DayGroup {
  date: string;
  label: string;
  memories: MemoryRecord[];
}

interface Props {
  loading?: boolean;
  /** Set when the memory load failed. Distinct from an empty store — H2:
   *  without this, a 401 or a network failure rendered the same "No memories
   *  yet" copy as a genuinely empty brain, while the status bar on the same
   *  screen said "653 memories". */
  error?: string | null;
  onRetry?: () => void;
}

export default function TimelineView({ loading, error, onRetry }: Props) {
  const records = useMemoryStore((s) => s.records);
  const t = useTemplateStore((s) => s.activeTemplate);
  const stats = useServerStats();

  const groups = useMemo((): DayGroup[] => {
    // W10: a REST/socket-sourced createdAt that fails to parse must not
    // throw here — one bad row used to blank the entire timeline (there is
    // no error boundary anywhere in the app). It's grouped under its own
    // "Unknown date" bucket instead, so the memory stays visible.
    const sorted = [...records].sort(
      (a, b) => (safeParseISO(b.createdAt)?.getTime() ?? 0) - (safeParseISO(a.createdAt)?.getTime() ?? 0)
    );
    const map = new Map<string, MemoryRecord[]>();
    for (const mem of sorted) {
      const parsed = safeParseISO(mem.createdAt);
      const key = parsed ? startOfDay(parsed).toISOString() : UNKNOWN_DATE_KEY;
      const list = map.get(key) ?? [];
      list.push(mem);
      map.set(key, list);
    }
    return Array.from(map.entries()).map(([date, memories]) => ({
      date,
      label: date === UNKNOWN_DATE_KEY ? UNKNOWN_DATE_LABEL : formatDayHeading(date),
      memories,
    }));
  }, [records]);

  // H2: three distinct branches, the shape AnalyticsView already used — a
  // pending load, a failed load and a genuinely empty store are three
  // different facts and used to render as one.
  if (loading && records.length === 0) {
    return <div style={{ ...s.center, color: t.textMuted }}>Loading memories…</div>;
  }

  if (error && records.length === 0) {
    return (
      <div style={{ ...s.center, flexDirection: 'column', gap: SPACE.md, color: STATUS.danger }}>
        <div>Could not load memories: {error}</div>
        {onRetry && (
          <button
            className="ec-hover-tint"
            style={{
              background: 'transparent',
              border: `1px solid ${STATUS.danger}`,
              color: STATUS.danger,
              borderRadius: RADIUS.sm,
              padding: `${SPACE.xs} ${SPACE.lg}`,
              fontSize: TYPE.base,
              fontFamily: 'inherit',
            }}
            onClick={onRetry}
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div style={{ ...s.empty, color: t.textMuted }}>
        No memories yet. Store something to see the timeline.
      </div>
    );
  }

  // H6: the timeline rendered exactly 200 cards and said nothing about it.
  const total = stats?.total ?? records.length;

  return (
    <div style={{ ...s.root, background: t.rootBg }}>
      <div style={s.rail}>
        <div className="ec-tabular" style={{ ...s.caption, color: t.textMuted }}>
          {total > records.length
            ? `Showing the ${records.length} most recent of ${total} memories`
            : `${records.length} ${records.length === 1 ? 'memory' : 'memories'}`}
        </div>
        {groups.map((group) => (
          <div key={group.date} style={s.dayGroup}>
            <div style={{ ...s.dateLabel, color: t.accent }}>{group.label}</div>
            <div style={{ ...s.line, background: t.panelBorder }} />
            <div style={s.cards}>
              {group.memories.map((mem) => (
                <TimelineCard key={mem.id} memory={mem} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineCard({ memory }: { memory: MemoryRecord }) {
  const t = useTemplateStore((s) => s.activeTemplate);
  const typeColor = TYPE_COLORS[memory.type] ?? t.accent;
  // H4: the card printed raw Markdown, so most of them opened with a literal
  // '# Memory Analysis:' or '**Most Significant Contradiction:**'.
  const body = toPlainText(memory.content);

  return (
    <div style={{ ...s.card, background: t.cardBg, borderColor: t.panelBorder }}>
      <div style={s.cardHeader}>
        {/* M8: was `typeColor + '20'` — the hex-concat trick withAlpha exists
            to replace. Mono's accent is '#ffffff'; any future short or rgb()
            token silently yields an invalid colour. */}
        <span style={{ ...s.typeBadge, background: withAlpha(typeColor, 0.125), color: typeColor }}>
          {memory.type}
        </span>
        <span className="ec-tabular" style={{ ...s.time, color: t.textMuted }}>
          {formatTimeOfDay(memory.createdAt)}
        </span>
      </div>
      <div className="ec-wrap-anywhere" style={{ ...s.content, color: t.textPrimary }}>
        {body.length > CARD_EXCERPT_LENGTH ? body.slice(0, CARD_EXCERPT_LENGTH) + '…' : body}
      </div>
      <div style={s.cardFooter}>
        {memory.concept && (
          <span style={{ ...s.concept, color: t.textSecondary }}>{GLYPH.concept} {toPlainText(memory.concept)}</span>
        )}
        <span className="ec-tabular" style={{ ...s.importance, color: t.textMuted }}>
          {GLYPH.importance} {(memory.importance * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

// M7: every size and space here was a raw literal — the file imported
// TYPE_COLORS from lib/tokens.ts and nothing else. Substituted to the
// nearest scale step (ties resolved upward), which is what makes the token
// layer real rather than aspirational.
const s = {
  root: {
    flex: 1,
    overflow: 'auto',
    padding: 'clamp(16px, 5vw, 32px) clamp(16px, 6vw, 48px)',
  },
  rail: {
    maxWidth: '720px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: SPACE['2xl'],
  },
  caption: {
    fontSize: TYPE.sm,
    paddingLeft: SPACE['2xl'],
  },
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: TYPE.lg,
  },
  center: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: TYPE.lg,
  },
  dayGroup: {
    position: 'relative' as const,
    paddingLeft: SPACE['2xl'],
  },
  dateLabel: {
    fontSize: TYPE.base,
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    marginBottom: SPACE.md,
  },
  line: {
    position: 'absolute' as const,
    left: SPACE.xs,
    top: SPACE['2xl'],
    bottom: 0,
    width: '2px',
    borderRadius: '1px',
  },
  cards: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: SPACE.md,
  },
  card: {
    border: '1px solid',
    borderRadius: RADIUS.lg,
    padding: `${SPACE.lg} ${SPACE.lg}`,
    transition: 'transform 0.15s, box-shadow 0.15s',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACE.sm,
  },
  typeBadge: {
    fontSize: TYPE.xs,
    fontWeight: 600,
    padding: `${SPACE['3xs']} ${SPACE.sm}`,
    borderRadius: RADIUS.tight,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
  },
  time: {
    fontSize: TYPE.sm,
  },
  content: {
    fontSize: TYPE.md,
    lineHeight: 1.5,
    marginBottom: SPACE.sm,
  },
  cardFooter: {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE.md,
    flexWrap: 'wrap' as const,
  },
  concept: {
    fontSize: TYPE.sm,
  },
  importance: {
    fontSize: TYPE.sm,
  },
} as const;
