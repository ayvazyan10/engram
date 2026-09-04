import { useCallback, useEffect } from 'react';
import { isAnalyticsData, useAnalyticsStore } from '../../store/analyticsStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { api } from '../../lib/api.js';
import { RADIUS, SPACE, STATUS, TYPE } from '../../lib/tokens.js';
import {
  ConceptPanel, GrowthPanel, HeatmapPanel, SourcePanel, StatsRow, TypePanel,
} from './analytics/AnalyticsPanels.js';
import { describeWindow } from './analytics/format.js';

// The chart configuration lives in ./analytics — one component per panel, so
// this file stays the page's structure: fetch, the three load branches, the
// scope statement, and the panels in order.
export {
  describeCoverage, describeWindow, percent, truncateSourceLabel,
  SOURCE_AXIS_WIDTH, SOURCE_LABEL_MAX,
} from './analytics/format.js';

interface Props {
  /** The app-level memory load state AppLayout threads to every view. This
   *  view owns its own analytics request, so these only stand in when it has
   *  nothing of its own to say — an auth failure fails both, and reporting it
   *  once here beats reporting nothing. */
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export default function AnalyticsView({ loading: appLoading, error: appError, onRetry }: Props) {
  const { data, loading, days, error, setData, setLoading, setError } = useAnalyticsStore();
  const t = useTemplateStore((s) => s.activeTemplate);

  // The response shape is checked before it is trusted. The endpoint was
  // restructured under this view (flat and scope-mixed -> windowed/allTime with
  // an explicit window), and a shape this dashboard does not understand has to
  // reach the error branch rather than render a page of `undefined`.
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.getAnalytics(days)
      .then((payload) => {
        if (!isAnalyticsData(payload)) {
          setError('the analytics endpoint returned a shape this dashboard does not understand');
          return;
        }
        setData(payload);
      })
      .catch((e: Error) => setError(e.message))
      // Without this, loading stayed true forever after a successful load.
      .finally(() => setLoading(false));
  }, [days, setData, setLoading, setError]);

  useEffect(() => { load(); }, [load]);

  // A failed request used to be indistinguishable from an empty dataset.
  const failure = error ?? appError ?? null;
  if (failure && !data) {
    return (
      <div style={{ ...s.center, flexDirection: 'column', gap: SPACE.md, color: STATUS.danger }}>
        <div>Could not load analytics: {failure}</div>
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
          onClick={() => {
            onRetry?.();
            load();
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  // Nothing to draw yet: either a request is in flight, or the effect that
  // starts one has not run (it runs after the first commit). Both are a
  // pending load — the branch that used to sit here said "No analytics data
  // available", which is a claim about the data rather than the request.
  if (!data) {
    return <div style={{ ...s.center, color: t.textMuted }}>Loading analytics…</div>;
  }

  // A REFETCH holds the frame instead of tearing it down: the previous render
  // stays, dimmed, so there is no skeleton flash and no layout jump when the
  // window changes or the view is reopened.
  const refreshing = loading || Boolean(appLoading);
  const w = data.windowed;

  return (
    <div
      style={{ ...s.root, background: t.rootBg, opacity: refreshing ? 0.55 : 1 }}
      aria-busy={refreshing || undefined}
    >
      {/* One scope statement, above everything it scopes.
          Every figure below it except the explicitly-labelled all-time
          denominators covers exactly this window. It used to be impossible to
          know: `byType` and `bySource` were windowed and summed to 87 while the
          tile beside them said 651, with nothing on screen saying which was
          which. The server states the window now, so the page prints it. */}
      <p
        className="ec-tabular"
        style={{ ...s.scope, color: t.textMuted, borderColor: t.panelBorder }}
        title={`Computed ${data.window.generatedAt}`}
      >
        {describeWindow(data.window)}
        {data.excludesArchived ? ' · archived memories excluded' : ''}
      </p>

      <StatsRow data={data} />

      {/* Third branch, re-pointed. It used to fire on `data === null`, which
          after a successful fetch is unreachable — so the honest "empty" case
          is an empty WINDOW, and it is worth telling apart from a failure
          because the store may hold plenty and just hold nothing in these 30
          days. The scope line and the all-time tiles stay on screen above it
          so a reader can see that for themselves. */}
      {w.total === 0 ? (
        <div style={{ ...s.emptyWindow, background: t.cardBg, borderColor: t.panelBorder, color: t.textMuted }}>
          No memories were stored in this window. The store holds {data.allTime.total}.
        </div>
      ) : (
        <>
          <GrowthPanel w={w} days={data.window.days} />
          <div style={s.row}>
            <TypePanel w={w} />
            <SourcePanel w={w} />
          </div>
          <ConceptPanel w={w} />
          <HeatmapPanel w={w} />
        </>
      )}
    </div>
  );
}

// M7: this file imported the memory-type palette and STATUS from lib/tokens.ts
// and never TYPE, SPACE or RADIUS — every size and space below was a raw
// literal, with radius 12px and font sizes written as strings. Substituted to
// the nearest scale step.
const s = {
  root: {
    flex: 1,
    overflow: 'auto',
    // clamp() rather than a fixed breakpoint — V3: 320px needs ~16px of
    // breathing room, 1920px can afford the original 36px, and everything
    // between scales instead of jumping.
    padding: 'clamp(16px, 4vw, 28px) clamp(16px, 5vw, 36px)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: SPACE.xl,
  },
  center: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: TYPE.lg,
  },
  scope: {
    margin: 0,
    paddingBottom: SPACE.sm,
    borderBottom: '1px solid',
    fontSize: TYPE.sm,
    letterSpacing: '0.01em',
  },
  emptyWindow: {
    border: '1px solid',
    borderRadius: RADIUS.lg,
    padding: SPACE.xl,
    fontSize: TYPE.md,
  },
  row: {
    display: 'grid',
    // auto-fit + minmax rather than a fixed '1fr 1fr' — the two chart
    // panels stack to a single column on their own once the viewport can't
    // give each at least 260px, instead of squeezing a pie chart into ~140px
    // at 320-375px (V3).
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: SPACE.lg,
  },
} as const;
