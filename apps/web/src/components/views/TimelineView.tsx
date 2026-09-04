import { useMemo } from 'react';
import { format, startOfDay } from 'date-fns';
import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { TYPE_COLORS } from '../../lib/tokens.js';
import { safeParseISO } from '../../lib/dates.js';

const UNKNOWN_DATE_KEY = 'unknown';

interface DayGroup {
  date: string;
  label: string;
  memories: MemoryRecord[];
}

export default function TimelineView() {
  const records = useMemoryStore((s) => s.records);
  const t = useTemplateStore((s) => s.activeTemplate);

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
      label: date === UNKNOWN_DATE_KEY ? 'Unknown date' : format(safeParseISO(date)!, 'MMM d, yyyy'),
      memories,
    }));
  }, [records]);

  if (records.length === 0) {
    return (
      <div style={{ ...s.empty, color: t.textMuted }}>
        No memories yet. Store something to see the timeline.
      </div>
    );
  }

  return (
    <div style={{ ...s.root, background: t.rootBg }}>
      <div style={s.rail}>
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

  return (
    <div style={{ ...s.card, background: t.cardBg, borderColor: t.panelBorder }}>
      <div style={s.cardHeader}>
        <span style={{ ...s.typeBadge, background: typeColor + '20', color: typeColor }}>
          {memory.type}
        </span>
        <span style={{ ...s.time, color: t.textMuted }}>
          {(() => {
            const parsed = safeParseISO(memory.createdAt);
            return parsed ? format(parsed, 'HH:mm') : '--:--';
          })()}
        </span>
      </div>
      <div style={{ ...s.content, color: t.textPrimary }}>
        {memory.content.length > 160 ? memory.content.slice(0, 160) + '…' : memory.content}
      </div>
      <div style={s.cardFooter}>
        {memory.concept && (
          <span style={{ ...s.concept, color: t.textSecondary }}>⬡ {memory.concept}</span>
        )}
        <span style={{ ...s.importance, color: t.textMuted }}>
          ◉ {(memory.importance * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

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
    gap: '32px',
  },
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
  },
  dayGroup: {
    position: 'relative' as const,
    paddingLeft: '24px',
  },
  dateLabel: {
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    marginBottom: '12px',
  },
  line: {
    position: 'absolute' as const,
    left: '6px',
    top: '28px',
    bottom: 0,
    width: '2px',
    borderRadius: '1px',
  },
  cards: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '10px',
  },
  card: {
    border: '1px solid',
    borderRadius: '10px',
    padding: '14px 16px',
    transition: 'transform 0.15s, box-shadow 0.15s',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },
  typeBadge: {
    fontSize: '10px',
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: '4px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
  },
  time: {
    fontSize: '11px',
  },
  content: {
    fontSize: '13px',
    lineHeight: '1.5',
    marginBottom: '8px',
  },
  cardFooter: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  concept: {
    fontSize: '11px',
  },
  importance: {
    fontSize: '11px',
  },
} as const;
