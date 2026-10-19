import { useId, useState, type ReactNode } from 'react';

/**
 * A chart with its table twin. Every value a chart draws is also in a real
 * <table>, which is the keyboard, touch and screen-reader path, so nothing on
 * this page needs a hover to be read. The toggle is a button with
 * `aria-pressed`.
 */

export interface TableColumn {
  key: string;
  label: string;
  /** Right-aligned, in tabular figures: the one place they belong. */
  numeric?: boolean;
}

export interface TableSpec {
  columns: readonly TableColumn[];
  rows: ReadonlyArray<Record<string, string | number>>;
}

interface Props {
  title: string;
  /** What the panel shows: the window, the denominator, the range. */
  caption?: string;
  table: TableSpec;
  /** A panel that spans both columns of the grid. */
  wide?: boolean;
  children: ReactNode;
}

export default function ChartPanel({ title, caption, table, wide, children }: Props) {
  const [showTable, setShowTable] = useState(false);
  const bodyId = useId();
  const titleId = useId();

  return (
    <section className="in-panel" data-wide={wide || undefined} aria-labelledby={titleId}>
      <header className="in-panel-h">
        <h2 id={titleId}>{title}</h2>
        {caption && <span className="in-cap">{caption}</span>}
        <button
          type="button"
          className="in-toggle"
          aria-pressed={showTable}
          aria-controls={bodyId}
          title={showTable ? `Show the ${title} chart` : `Show ${title} as a table of values`}
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? 'Chart' : 'Table'}
        </button>
      </header>
      <div id={bodyId}>{showTable ? <DataTable title={title} table={table} /> : children}</div>
    </section>
  );
}

export function DataTable({ title, table }: { title: string; table: TableSpec }) {
  return (
    <div className="in-table-wrap">
      <table className="in-table">
        <caption>{title}, every value</caption>
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th key={c.key} scope="col" data-numeric={c.numeric || undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {table.columns.map((c) => (
                <td key={c.key} data-numeric={c.numeric || undefined}>
                  {row[c.key] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.rows.length === 0 && <p className="in-table-empty">No rows in this window.</p>}
    </div>
  );
}
