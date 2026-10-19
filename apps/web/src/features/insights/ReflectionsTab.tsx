import { useEffect, useRef, useState } from 'react';
import { useReflectionStore, type ReflectionInsight } from '../../store/reflectionStore.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { api, ApiError } from '../../lib/api.js';
import { formatDateTime, formatShortDate } from '../../lib/dates.js';
import { toReadableText } from '../../lib/plainText.js';

/** Reports sharing at least this share of their words (Jaccard) fold together. */
export const NEAR_IDENTICAL = 0.6;
/** Reflections fetched per load (the server allows up to 200). */
const LIMIT = 100;
/** A body longer than this is clamped, with Show all. */
const LONG = 420;

export const KINDS: { type: string; label: string }[] = [
  { type: 'pattern', label: 'Pattern' },
  { type: 'knowledge_gap', label: 'Knowledge gap' },
  { type: 'trend', label: 'Trend' },
  { type: 'contradiction_summary', label: 'Contradiction' },
];

const kindLabel = (type: string) => KINDS.find((k) => k.type === type)?.label ?? type;

export interface ReflectionGroup {
  lead: ReflectionInsight;
  /** Near-identical reports, newest first, folded under the lead. */
  twins: ReflectionInsight[];
}

function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2));
}

/**
 * The reflection engine often writes the same report several times. Each
 * report joins the first earlier-listed one of its type that shares at least
 * NEAR_IDENTICAL of their words (Jaccard), or starts a group of its own.
 */
export function foldReflections(insights: ReflectionInsight[]): ReflectionGroup[] {
  const groups: (ReflectionGroup & { words: Set<string> })[] = [];
  for (const insight of insights) {
    const mine = words(insight.content);
    const home = groups.find((g) => {
      if (g.lead.type !== insight.type) return false;
      let shared = 0;
      for (const w of mine) if (g.words.has(w)) shared++;
      const union = mine.size + g.words.size - shared;
      return union > 0 && shared / union >= NEAR_IDENTICAL;
    });
    if (home) home.twins.push(insight);
    else groups.push({ lead: insight, twins: [], words: mine });
  }
  return groups.map(({ lead, twins }) => ({ lead, twins }));
}

/** The report without the title lines the writer opens with ("# Trend Analysis",
 *  "**Most Significant Trend:**"), as readable paragraphs. */
export function reflectionBody(content: string): string {
  const lines = content.split('\n');
  let start = 0;
  while (start < lines.length && /^\s*(#{1,6}\s.*|\*\*[^*]+\*\*:?\s*|)$/.test(lines[start]!)) start++;
  // A label run into the first paragraph ("**Most Significant Gap:** The…") goes too.
  const rest = lines.slice(start).join('\n').replace(/^\s*\*\*[^*\n]+?(:\*\*|\*\*:)\s*/, '');
  return toReadableText(rest) || toReadableText(content);
}

/**
 * Insights › Reflections: what the reflection engine concluded about the
 * store, one readable report per finding, with repeats folded. Each report is
 * a memory, so it opens in the memory sheet.
 */
export default function ReflectionsTab() {
  const { insights, status, loading, filterType, error, setInsights, setStatus, setLoading, setFilterType, setError } = useReflectionStore();
  const [attempt, setAttempt] = useState(0);
  // A response for a filter the reader has since left is dropped.
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current;
    setLoading(true);
    Promise.all([api.getReflections(LIMIT, filterType ?? undefined), api.getReflectionStatus()])
      .then(([list, cycle]) => {
        if (request !== latest.current) return;
        setInsights(list.reflections);
        setStatus(cycle);
        setError(null);
      })
      .catch((err: unknown) => {
        if (request !== latest.current || (err instanceof ApiError && err.status === 401)) return;
        setError(err instanceof Error ? err.message : 'Could not reach Engram');
      })
      .finally(() => {
        if (request === latest.current) setLoading(false);
      });
  }, [filterType, attempt, setInsights, setStatus, setLoading, setError]);

  const groups = foldReflections(insights);
  const folded = insights.length - groups.length;
  const remaining = status ? Math.max(0, status.threshold - status.counter) : 0;

  return (
    <div className="in-refl">
      <div className="in-filters">
        <div className="at-seg" role="radiogroup" aria-label="Kind of report">
          {[{ type: null, label: 'All' }, ...KINDS].map((k) => (
            <label key={k.label} className="at-seg-opt">
              <input type="radio" name="reflection-kind" checked={filterType === k.type} onChange={() => setFilterType(k.type)} />
              {k.label}
            </label>
          ))}
        </div>
        {status && (
          <p className="in-scope">
            {!status.enabled
              ? 'Reflection is off on this server.'
              : status.due
                ? 'A reflection cycle is due: ask your AI to run request_reflection, then store_reflection for each finding.'
                : `The next cycle is due after ${remaining} more stored ${remaining === 1 ? 'memory' : 'memories'}.`}{' '}
            Reports cover every project.
          </p>
        )}
      </div>

      {error ? (
        <div className="in-state" role="alert">
          <h2>Could not load the reflections</h2>
          <p>{error}</p>
          <button type="button" className="at-btn sec" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : loading && insights.length === 0 ? (
        <div className="in-state" aria-label="Loading">
          {[0, 1, 2].map((i) => (
            <i key={i} className="mm-skel" style={{ width: `${82 - i * 14}%` }} />
          ))}
        </div>
      ) : groups.length === 0 ? (
        filterType ? (
          <div className="in-state">
            <h2>No {kindLabel(filterType).toLowerCase()} reports yet</h2>
            <p>The reflection engine has not written one of this kind.</p>
            <button type="button" className="at-btn sec" onClick={() => setFilterType(null)}>
              Show every kind
            </button>
          </div>
        ) : (
          <div className="in-state">
            <h2>No reflections yet</h2>
            <p>
              Your AI writes them: after enough new memories it runs request_reflection, reads what Engram hands back, and stores
              each finding with store_reflection. They appear here once stored.
            </p>
          </div>
        )
      ) : (
        <div aria-busy={loading || undefined} data-refreshing={loading || undefined} className="in-body">
          <p className="in-count">
            {groups.length} distinct {groups.length === 1 ? 'report' : 'reports'}
            {folded > 0 && `. ${folded} near-identical ${folded === 1 ? 'one is' : 'ones are'} folded into them`}.
          </p>
          <ol className="in-reports">
            {groups.map((g) => (
              <Report key={g.lead.id} group={g} />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Report({ group }: { group: ReflectionGroup }) {
  const selectNeuron = useNeuralStore((s) => s.selectNeuron);
  const [expanded, setExpanded] = useState(false);
  const [twinsOpen, setTwinsOpen] = useState(false);
  const { lead, twins } = group;
  const body = reflectionBody(lead.content);
  const long = body.length > LONG;
  return (
    <li className="in-report">
      <header>
        <b>{kindLabel(lead.type)}</b>
        {typeof lead.confidence === 'number' && <span>Confidence {Math.round(lead.confidence * 100)}%</span>}
        <time dateTime={lead.createdAt} title={formatDateTime(lead.createdAt)}>
          {formatShortDate(lead.createdAt)}
        </time>
      </header>
      <p className="in-report-t" data-clamped={long && !expanded ? 'true' : undefined}>
        {body}
      </p>
      <div className="in-report-a">
        {long && (
          <button type="button" className="mm-quiet" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Show less' : `Show all ${body.length.toLocaleString('en-US')} characters`}
          </button>
        )}
        <button type="button" className="mm-quiet" onClick={() => selectNeuron(lead.id)}>
          Open as a memory
        </button>
        {twins.length > 0 && (
          <button type="button" className="mm-quiet" aria-expanded={twinsOpen} onClick={() => setTwinsOpen((v) => !v)}>
            {twins.length} near-identical {twins.length === 1 ? 'report' : 'reports'}
          </button>
        )}
      </div>
      {twinsOpen && (
        <ul className="in-twins">
          {twins.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => selectNeuron(t.id)}>
                <span>{formatDateTime(t.createdAt)}</span>
                {typeof t.confidence === 'number' && <small>Confidence {Math.round(t.confidence * 100)}%</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
