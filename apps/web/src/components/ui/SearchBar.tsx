import { useState, useCallback, useRef } from 'react';
import { api, ApiError } from '../../lib/api.js';
import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { RADIUS, SPACE, STATUS, TYPE, WEIGHT, withAlpha } from '../../lib/tokens.js';

/** `large` is Home's version: the same field, front and centre — no strip
 *  around it, a bigger target and type. */
/** recall_context's own default budget, so the context Home shows under
 *  "What my AI knows" is the block an MCP client gets for the same words. */
const RECALL_MAX_TOKENS = 2000;

export default function SearchBar({ large = false, placeholder = 'Ask your memory anything…' }: { large?: boolean; placeholder?: string }) {
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // W4: bumped once per search kicked off, and captured per-call so a
  // response can tell whether a newer search has since superseded it. Two
  // requests in flight at once shouldn't be reachable now that `loading`
  // gates the start of a new one below (Enter used to bypass that gate —
  // only the button had `disabled={loading}` — which is what let it happen
  // in the first place), but this makes "the newest request always wins"
  // true regardless of *how* a second one got started, rather than relying
  // solely on that gate never being bypassed again.
  const latestRequestId = useRef(0);
  const { setSearchResults, setSearching, setContext, setSearchQuery, setHighlightedIds, searchQuery } = useMemoryStore();
  const t = useTemplateStore((s) => s.activeTemplate);

  const hasQuery = searchQuery.length > 0;

  const handleSearch = useCallback(async () => {
    const query = input.trim();
    if (!query || loading) return;
    const requestId = ++latestRequestId.current;
    setLoading(true);
    setSearching(true);
    setError(null);
    try {
      const [searchRes, recallRes] = await Promise.all([
        api.search(query, 20),
        api.recall(query, RECALL_MAX_TOKENS),
      ]);
      if (requestId !== latestRequestId.current) return; // superseded — drop it
      const results = searchRes.results as MemoryRecord[];
      // Committed together, and only on success: setting the query eagerly
      // (before the request settled) is what let a failed "auth token"
      // search leave the "auth" results on screen under the "auth token"
      // label — this way a failure leaves the last successful query/result
      // pair alone, self-consistent, instead of relabeling it.
      setSearchQuery(query);
      setSearchResults(results);
      setHighlightedIds(new Set(results.map((r) => r.id)));
      setContext(recallRes.context, recallRes.latencyMs, recallIds(recallRes.memories));
    } catch (err) {
      if (requestId !== latestRequestId.current) return; // superseded — drop it
      // Status 0 is a request that never got an answer (lib/api.ts); its raw
      // message is "Failed to fetch: /search", which says nothing a reader
      // can act on.
      setError(
        err instanceof ApiError && err.status === 0
          ? 'Search failed — is the Engram server running?'
          : err instanceof Error ? err.message : 'Search failed'
      );
    } finally {
      if (requestId === latestRequestId.current) {
        setLoading(false);
        setSearching(false);
      }
    }
  }, [input, loading, setSearchResults, setSearching, setContext, setSearchQuery, setHighlightedIds]);

  const handleClear = useCallback(() => {
    setInput('');
    setError(null);
    setSearchQuery('');
    setSearchResults([]);
    // null, not 0: a cleared search has no recall latency, and 0 printed
    // "recall 0ms" in the status bar.
    setContext('', null);
    setHighlightedIds(new Set());
    inputRef.current?.focus();
  }, [setSearchQuery, setSearchResults, setContext, setHighlightedIds]);

  // Right pattern for a custom (non-:focus-visible) focus treatment: outline
  // is compensated for by a computed border + box-shadow, never just removed
  // (V2). This one stays hand-rolled — a plain outline ring would clip
  // against the rounded field — but every *other* interactive element in the
  // app now gets its ring from the global :focus-visible rule. The field is
  // flat when idle; the only shadow it ever wears is the focus ring.
  const borderColor = focused ? t.accent : hasQuery ? withAlpha(t.accent, 0.55) : t.panelBorder;
  const boxShadow   = focused ? `0 0 0 3px ${t.accentGlow}` : 'none';
  const iconStroke  = focused || hasQuery ? t.accent : t.textMuted;

  return (
    <div style={large ? styles.wrapperLarge : { ...styles.wrapper, background: t.panelBg, borderBottomColor: t.panelBorder }}>
      {/* Input row */}
      <div style={{ ...styles.container, ...(large ? styles.containerLarge : {}), background: t.inputBg, borderColor, boxShadow }}>
        {/* Search icon / spinner */}
        <div style={styles.iconWrap}>
          {loading ? (
            <svg style={styles.spinner} viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke={t.accent} strokeWidth="2" strokeDasharray="28" strokeDashoffset="10" strokeLinecap="round" />
            </svg>
          ) : (
            <svg style={styles.searchIcon} viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="5.5" stroke={iconStroke} strokeWidth="1.5" />
              <path d="M13 13l3.5 3.5" stroke={iconStroke} strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </div>

        <input
          ref={inputRef}
          style={{ ...styles.input, ...(large ? styles.inputLarge : {}), color: t.textPrimary }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch();
            if (e.key === 'Escape') handleClear();
          }}
          placeholder={placeholder}
          aria-label="Search memories"
          spellCheck={false}
          autoComplete="off"
        />

        {/* Clear button */}
        {input && (
          <button className="ec-hover-tint" style={{ ...styles.clearBtn, color: t.textMuted }} onClick={handleClear} title="Clear (Esc)" aria-label="Clear search">
            <svg viewBox="0 0 16 16" fill="none" style={{ width: 10, height: 10 }} aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        )}

        {/* Search button */}
        <button
          className="ec-primary"
          style={{ ...styles.searchBtn, ...(large ? styles.searchBtnLarge : {}), background: t.accentStrong, color: t.onAccent }}
          onClick={handleSearch}
          disabled={loading}
          title="Search (Enter)"
          aria-label="Search"
        >
          <svg viewBox="0 0 16 16" fill="none" style={{ width: 13, height: 13 }} aria-hidden="true">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Error — a failed search is surfaced here, not just console.error'd
          (W4). A stale prior query/result pair is left alone above (see
          handleSearch), so this reads as "that search failed" rather than
          silently relabeling old results under the new query. */}
      {error && (
        <div style={{ ...styles.errorBanner, color: STATUS.danger, background: withAlpha(STATUS.danger, 0.1) }} role="alert">
          {error}
        </div>
      )}

      {/* One line under the field, doing one job at a time: the two keys
          while idle, and the live query once semantic recall is on. The old
          "SEARCH" eyebrow above the field is gone — the placeholder already
          says what the field is. */}
      <div style={{ ...styles.hint, color: t.textMuted }}>
        {hasQuery ? (
          <>
            <span aria-hidden="true" style={{ ...styles.activeDot, background: t.accent }} />
            <span style={{ color: t.textSecondary, flexShrink: 0 }}>Semantic recall for</span>
            <span style={{ ...styles.query, color: t.textPrimary }} title={searchQuery}>&ldquo;{searchQuery}&rdquo;</span>
          </>
        ) : (
          <>
            <kbd className="ec-kbd">Enter</kbd>
            <span>search</span>
            <kbd className="ec-kbd" style={{ marginLeft: SPACE.xs }}>Esc</kbd>
            <span>clear</span>
          </>
        )}
      </div>
    </div>
  );
}

/** The full ids behind the recall block, which prints only 8-character
 *  prefixes. */
function recallIds(memories: unknown[]): string[] {
  return memories.flatMap((m) =>
    m && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'string' ? [(m as { id: string }).id] : []
  );
}

const styles = {
  wrapper: {
    padding: `${SPACE.md} ${SPACE.lg} ${SPACE.sm}`,
    borderBottom: '1px solid',
  },
  wrapperLarge: {},
  containerLarge: {
    borderRadius: RADIUS.lg,
    padding: '5px 5px 5px 12px',
  },
  inputLarge: {
    fontSize: TYPE.lg,
    padding: `${SPACE.sm} ${SPACE.xs}`,
  },
  searchBtnLarge: {
    width: 36,
    height: 36,
  },
  container: {
    display: 'flex',
    alignItems: 'center',
    border: '1px solid',
    borderRadius: RADIUS.md,
    padding: '3px 3px 3px 9px',
    gap: SPACE['3xs'],
  },
  iconWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    flexShrink: 0,
  },
  searchIcon: {
    width: 15,
    height: 15,
  },
  spinner: {
    width: 15,
    height: 15,
    animation: 'ec-spin 0.8s linear infinite',
  },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    padding: `${SPACE.xs} ${SPACE.xs}`,
    fontSize: TYPE.base,
    lineHeight: 1.4,
    // M5: form controls do not inherit font-family. Without this the search
    // field — the most prominent input in the app — computed to Arial while
    // everything around it was the body face.
    fontFamily: 'inherit',
    outline: 'none',
    minWidth: 0,
  },
  clearBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    // M6: was 22x22, under the 24x24 WCAG 2.2 target minimum.
    width: 24,
    height: 24,
    background: 'transparent',
    border: 'none',
    borderRadius: RADIUS.sm,
    flexShrink: 0,
  },
  searchBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    border: 'none',
    borderRadius: RADIUS.sm,
    flexShrink: 0,
  },
  errorBanner: {
    marginTop: SPACE.xs,
    padding: `${SPACE.xs} ${SPACE.sm}`,
    borderRadius: RADIUS.sm,
    fontSize: TYPE.xs,
    lineHeight: 1.4,
  },
  hint: {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE['2xs'],
    marginTop: SPACE.sm,
    minHeight: 16,
    fontSize: TYPE.xs,
    paddingLeft: SPACE['3xs'],
    overflow: 'hidden',
    whiteSpace: 'nowrap' as const,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    display: 'inline-block',
    flexShrink: 0,
    marginRight: SPACE['3xs'],
  },
  query: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontWeight: WEIGHT.medium,
  },
} as const;
