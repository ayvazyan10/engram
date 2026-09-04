import { useState, useCallback, useRef } from 'react';
import { api } from '../../lib/api.js';
import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { RADIUS, SPACE, STATUS, TYPE, withAlpha } from '../../lib/tokens.js';

export default function SearchBar() {
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
        api.recall(query, 1500),
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
      setContext(recallRes.context, recallRes.latencyMs);
    } catch (err) {
      if (requestId !== latestRequestId.current) return; // superseded — drop it
      setError(err instanceof Error ? err.message : 'Search failed');
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
    setContext('', 0);
    setHighlightedIds(new Set());
    inputRef.current?.focus();
  }, [setSearchQuery, setSearchResults, setContext, setHighlightedIds]);

  // Right pattern for a custom (non-:focus-visible) focus treatment: outline
  // is compensated for by a computed border + box-shadow, never just removed
  // (V2). This one stays hand-rolled — a plain outline ring would clip
  // against the rounded pill — but every *other* interactive element in the
  // app now gets its ring from the global :focus-visible rule.
  const borderColor = focused ? t.accent : hasQuery ? withAlpha(t.accent, 0.6) : t.panelBorder;
  const boxShadow   = focused ? `0 0 0 3px ${t.accentGlow}, 0 2px 8px rgba(0,0,0,0.4)` : '0 2px 6px rgba(0,0,0,0.3)';
  const iconStroke  = focused ? t.accent : t.textMuted;

  return (
    <div style={{ ...styles.wrapper, background: `linear-gradient(180deg, ${t.panelBg} 0%, ${t.rootBg} 100%)`, borderBottomColor: t.panelBorder }}>
      {/* Label row */}
      <div style={styles.labelRow}>
        <span style={{ ...styles.label, color: t.textMuted }}>Search</span>
        {hasQuery && (
          <span style={{ ...styles.activeTag, color: t.accent }}>
            <span style={{ ...styles.activeDot, background: t.accent, boxShadow: `0 0 5px ${t.accent}` }} />
            semantic recall active
          </span>
        )}
      </div>

      {/* Input row */}
      <div style={{ ...styles.container, background: t.inputBg, borderColor, boxShadow }}>
        {/* Search icon / spinner */}
        <div style={styles.iconWrap}>
          {loading ? (
            <svg style={styles.spinner} viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke={t.accentStrong} strokeWidth="2" strokeDasharray="28" strokeDashoffset="10" strokeLinecap="round" />
            </svg>
          ) : (
            <svg style={styles.searchIcon} viewBox="0 0 20 20" fill="none">
              <circle cx="8.5" cy="8.5" r="5.5" stroke={iconStroke} strokeWidth="1.5" />
              <path d="M13 13l3.5 3.5" stroke={iconStroke} strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </div>

        <input
          ref={inputRef}
          style={{ ...styles.input, color: t.textPrimary }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch();
            if (e.key === 'Escape') handleClear();
          }}
          placeholder="Ask your memory anything…"
          spellCheck={false}
          autoComplete="off"
        />

        {/* Clear button */}
        {input && (
          <button className="ec-hover-bright" style={{ ...styles.clearBtn, background: t.cardBg }} onClick={handleClear} title="Clear (Esc)">
            <svg viewBox="0 0 16 16" fill="none" style={{ width: 10, height: 10 }}>
              <path d="M3 3l10 10M13 3L3 13" stroke={t.textMuted} strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        )}

        {/* Search button */}
        <button
          className="ec-hover-bright"
          style={{
            ...styles.searchBtn,
            background: `linear-gradient(135deg, ${t.accent} 0%, ${t.accentStrong} 100%)`,
            boxShadow: `0 2px 8px ${t.accentGlow}`,
            ...(loading ? styles.searchBtnLoading : {}),
          }}
          onClick={handleSearch}
          disabled={loading}
          title="Search (Enter)"
        >
          <svg viewBox="0 0 16 16" fill="none" style={{ width: 13, height: 13 }}>
            <path d="M3 8h10M9 4l4 4-4 4" stroke={t.onAccent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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

      {/* Hint row */}
      <div style={{ ...styles.hint, color: t.textMuted }}>
        <span>↵ search</span>
        <span>·</span>
        <span>esc clear</span>
        {hasQuery && (
          <>
            <span>·</span>
            <span style={{ color: t.accent }}>&quot;{searchQuery}&quot;</span>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    padding: `${SPACE.lg} ${SPACE.lg} ${SPACE.sm}`,
    borderBottom: '1px solid',
  },
  labelRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACE.sm,
  },
  label: {
    fontSize: TYPE.xs,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
  },
  activeTag: {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE['2xs'],
    fontSize: TYPE.micro,
    fontWeight: 500,
  },
  activeDot: {
    width: 5,
    height: 5,
    borderRadius: '50%',
    display: 'inline-block',
  },
  container: {
    display: 'flex',
    alignItems: 'center',
    border: '1px solid',
    borderRadius: RADIUS.lg,
    padding: '3px 3px 3px 10px',
    gap: '2px',
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
    padding: '8px 6px',
    fontSize: TYPE.md,
    outline: 'none',
    minWidth: 0,
    letterSpacing: '0.01em',
  },
  clearBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    border: 'none',
    borderRadius: RADIUS.sm,
    flexShrink: 0,
  },
  searchBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    border: 'none',
    borderRadius: RADIUS.sm,
    flexShrink: 0,
  },
  searchBtnLoading: {
    opacity: 0.5,
    cursor: 'not-allowed' as const,
  },
  errorBanner: {
    marginTop: SPACE.xs,
    padding: '6px 10px',
    borderRadius: RADIUS.sm,
    fontSize: TYPE.xs,
  },
  hint: {
    display: 'flex',
    gap: '5px',
    marginTop: SPACE.xs,
    fontSize: TYPE.xs,
    paddingLeft: '2px',
    overflow: 'hidden',
    whiteSpace: 'nowrap' as const,
    textOverflow: 'ellipsis',
  },
} as const;
