import { useId, useState, type ReactNode } from 'react';
import { useTemplateStore } from '../../../store/templateStore.js';
import { RADIUS, SPACE, TYPE, WEIGHT } from '../../../lib/tokens.js';

/**
 * The chart container, with the table twin every chart is supposed to have (F6).
 *
 * Three of the four charts on this page gated at least one value behind a
 * hover: the three smallest source bars render at roughly 12px, 10px and 5px
 * and are visually identical, and the heatmap had no hover handler at all. The
 * data-viz rules are explicit that "a tooltip as the only way to read a value"
 * is a defect and that every chart carries a table-view twin — and the table is
 * the cheapest way to discharge the whole class at once, because it is also the
 * keyboard path, the touch path and the screen-reader path.
 *
 * The toggle is an ordinary button with `aria-pressed`, and the table is a real
 * `<table>` with a caption, so nothing here needs a hover to be read.
 */

export interface TableColumn {
  key: string;
  label: string;
  /** Right-aligned columns get tabular figures — the one place they belong. */
  numeric?: boolean;
}

export interface TableSpec {
  columns: readonly TableColumn[];
  rows: ReadonlyArray<Record<string, string | number>>;
}

interface Props {
  title: string;
  /** Says what the panel is showing — the window, the denominator, the range. */
  caption?: string;
  table: TableSpec;
  children: ReactNode;
}

export default function ChartPanel({ title, caption, table, children }: Props) {
  const t = useTemplateStore((s) => s.activeTemplate);
  const [showTable, setShowTable] = useState(false);
  const bodyId = useId();

  return (
    <div style={{ ...s.panel, background: t.cardBg, borderColor: t.panelBorder }}>
      <div style={s.head}>
        <h3 style={{ ...s.title, color: t.textPrimary }}>{title}</h3>
        <div style={s.headRight}>
          {caption && (
            <span className="ec-tabular" style={{ ...s.caption, color: t.textMuted }}>{caption}</span>
          )}
          <button
            type="button"
            className="ec-hover-tint"
            aria-pressed={showTable}
            aria-controls={bodyId}
            title={showTable ? `Show the ${title} chart` : `Show ${title} as a table of values`}
            onClick={() => setShowTable((v) => !v)}
            style={{ ...s.toggle, color: showTable ? t.textPrimary : t.textMuted, borderColor: t.panelBorder }}
          >
            {showTable ? 'Chart' : 'Table'}
          </button>
        </div>
      </div>
      <div id={bodyId}>
        {showTable ? <DataTable title={title} table={table} /> : children}
      </div>
    </div>
  );
}

export function DataTable({ title, table }: { title: string; table: TableSpec }) {
  const t = useTemplateStore((st) => st.activeTemplate);
  return (
    <div style={s.tableScroll}>
      <table style={s.table}>
        <caption style={{ ...s.tableCaption, color: t.textMuted }}>{title} — every value</caption>
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={{ ...s.th, color: t.textMuted, background: t.cardBg, borderBottomColor: t.panelBorder, textAlign: c.numeric ? 'right' : 'left' }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {table.columns.map((c) => (
                <td
                  key={c.key}
                  className={c.numeric ? 'ec-tabular' : undefined}
                  style={{ ...s.td, color: c.numeric ? t.textPrimary : t.textSecondary, borderBottomColor: t.panelBorder, textAlign: c.numeric ? 'right' : 'left' }}
                >
                  {row[c.key] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.rows.length === 0 && (
        <div style={{ ...s.tableEmpty, color: t.textMuted }}>No rows in this window.</div>
      )}
    </div>
  );
}

const s = {
  panel: {
    border: '1px solid',
    borderRadius: RADIUS.lg,
    padding: SPACE.xl,
    minWidth: 0,
  },
  head: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: SPACE.sm,
    marginBottom: SPACE.lg,
    flexWrap: 'wrap' as const,
  },
  headRight: { display: 'flex', alignItems: 'center', gap: SPACE.sm },
  title: { fontSize: TYPE.md, fontWeight: WEIGHT.semibold, margin: 0 },
  caption: { fontSize: TYPE.sm },
  toggle: {
    background: 'transparent',
    border: '1px solid',
    borderRadius: RADIUS.sm,
    padding: `${SPACE['3xs']} ${SPACE.sm}`,
    fontSize: TYPE.xs,
    fontFamily: 'inherit',
    minHeight: 22,
  },
  tableScroll: { overflowX: 'auto' as const, maxHeight: 320, overflowY: 'auto' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: TYPE.sm },
  tableCaption: { textAlign: 'left' as const, fontSize: TYPE.xs, paddingBottom: SPACE.xs },
  th: {
    fontSize: TYPE.xs,
    fontWeight: WEIGHT.semibold,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    padding: `${SPACE['2xs']} ${SPACE.sm}`,
    borderBottom: '1px solid',
    position: 'sticky' as const,
    top: 0,
  },
  td: { padding: `${SPACE['2xs']} ${SPACE.sm}`, borderBottom: '1px solid' },
  tableEmpty: { fontSize: TYPE.sm, padding: SPACE.md },
} as const;
