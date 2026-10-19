import { useCallback, useEffect } from 'react';
import { isAnalyticsData, useAnalyticsStore } from '../../store/analyticsStore.js';
import { api, ApiError } from '../../lib/api.js';
import { ConceptPanel, GrowthPanel, HeatmapPanel, SourcePanel, StatsRow, TypePanel } from './AnalyticsPanels.js';
import { describeWindow } from './format.js';

/** The ranges on offer; the server accepts 1 to 365 days. */
export const RANGES = [7, 30, 90] as const;

/**
 * Insights › Numbers: what the store took in over the last 7, 30 or 90 days.
 * The window is stated once, above everything it scopes, with what it leaves
 * out: archived memories, and no project filter (GET /analytics has none, so
 * the scope switch cannot narrow these numbers).
 */
export default function NumbersTab() {
  const { data, loading, days, error, setData, setLoading, setError, setDays } = useAnalyticsStore();

  // The shape is checked before it is trusted: a payload this page does not
  // understand reaches the error state rather than a page of `undefined`.
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .getAnalytics(days)
      .then((payload) => {
        if (!isAnalyticsData(payload)) setError('the analytics endpoint returned a shape this dashboard does not understand');
        else setData(payload);
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) return;
        setError(e instanceof Error ? e.message : 'Could not reach Engram');
      })
      .finally(() => setLoading(false));
  }, [days, setData, setLoading, setError]);

  useEffect(load, [load]);

  const shownDays = data?.window.days;

  return (
    <div className="in-numbers">
      <div className="in-filters">
        <div className="at-seg" role="radiogroup" aria-label="Range">
          {RANGES.map((n) => (
            <label key={n} className="at-seg-opt">
              <input type="radio" name="insights-range" checked={days === n} onChange={() => setDays(n)} />
              {n} days
            </label>
          ))}
        </div>
        {data && (
          <p className="in-scope" title={`Computed ${data.window.generatedAt}`}>
            {describeWindow(data.window)}. Every project is counted, since these numbers cannot be narrowed to one
            {data.excludesArchived ? '; archived memories are not.' : '.'}
          </p>
        )}
      </div>

      {error && !data ? (
        <div className="in-state" role="alert">
          <h2>Could not load the numbers</h2>
          <p>{error}</p>
          <button type="button" className="at-btn sec" onClick={load}>
            Try again
          </button>
        </div>
      ) : !data ? (
        <div className="in-state" aria-label="Loading">
          {[0, 1, 2].map((i) => (
            <i key={i} className="mm-skel" style={{ width: `${80 - i * 15}%` }} />
          ))}
        </div>
      ) : (
        // A refetch holds the frame, dimmed, instead of flashing a skeleton.
        <div className="in-body" data-refreshing={loading || undefined} aria-busy={loading || undefined}>
          {error && (
            <p className="in-stale" role="alert">
              Could not refresh: {error}. These are the last numbers that loaded.
            </p>
          )}
          {data.allTime.total > 0 && <StatsRow data={data} />}
          {data.allTime.total === 0 ? (
            <div className="in-state">
              <h2>No numbers yet</h2>
              <p>Engram has no memories to count. Connect an AI, and what it stores is tallied here by day, type and source.</p>
              <a className="at-btn" href="#/welcome">
                Connect an AI
              </a>
            </div>
          ) : data.windowed.total === 0 ? (
            <div className="in-state">
              <h2>Nothing stored in the last {shownDays} days</h2>
              <p>
                The store holds {data.allTime.total.toLocaleString('en-US')} {data.allTime.total === 1 ? 'memory' : 'memories'}, all
                older than this window.
              </p>
              {days !== 90 && (
                <button type="button" className="at-btn sec" onClick={() => setDays(90)}>
                  Show 90 days
                </button>
              )}
            </div>
          ) : (
            <div className="in-grid">
              <GrowthPanel w={data.windowed} days={data.window.days} />
              <TypePanel w={data.windowed} />
              <SourcePanel w={data.windowed} />
              <HeatmapPanel w={data.windowed} />
              <ConceptPanel w={data.windowed} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
