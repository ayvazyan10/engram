import { useState, useCallback, useRef } from 'react';
import { api } from '../../lib/api.js';
import { useMemoryStore } from '../../store/memoryStore.js';

export default function SearchBar() {
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { setSearchResults, setSearching, setContext, setSearchQuery, searchQuery } = useMemoryStore();

  const hasQuery = searchQuery.length > 0;

  const handleSearch = useCallback(async () => {
    if (!input.trim()) return;
    setLoading(true);
    setSearching(true);
    setSearchQuery(input);
    try {
      const [searchRes, recallRes] = await Promise.all([
        api.search(input, 20),
        api.recall(input, 1500),
      ]);
      setSearchResults(searchRes.results as Parameters<typeof setSearchResults>[0]);
      setContext(recallRes.context, recallRes.latencyMs);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setLoading(false);
      setSearching(false);
    }
  }, [input, setSearchResults, setSearching, setContext, setSearchQuery]);

  const handleClear = useCallback(() => {
    setInput('');
    setSearchQuery('');
    setSearchResults([]);
    inputRef.current?.focus();
  }, [setSearchQuery, setSearchResults]);

  const borderColor = focused ? '#4f46e5' : hasQuery ? '#312e81' : '#0f2040';
  const boxShadow   = focused ? '0 0 0 3px rgba(99,102,241,0.12), 0 2px 8px rgba(0,0,0,0.4)' : '0 2px 6px rgba(0,0,0,0.3)';

  return (
    <div style={styles.wrapper}>
      {/* Label row */}
      <div style={styles.labelRow}>
        <span style={styles.label}>Search</span>
        {hasQuery && (
          <span style={styles.activeTag}>
            <span style={styles.activeDot} />
            semantic recall active
          </span>
        )}
      </div>

      {/* Input row */}
      <div style={{ ...styles.container, borderColor, boxShadow }}>
        {/* Search icon / spinner */}
        <div style={styles.iconWrap}>
          {loading ? (
            <svg style={styles.spinner} viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="#4f46e5" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10" strokeLinecap="round" />
            </svg>
          ) : (
            <svg style={styles.searchIcon} viewBox="0 0 20 20" fill="none">
              <circle cx="8.5" cy="8.5" r="5.5" stroke={focused ? '#818cf8' : '#334155'} strokeWidth="1.5" />
              <path d="M13 13l3.5 3.5" stroke={focused ? '#818cf8' : '#334155'} strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </div>

        <input
          ref={inputRef}
          style={styles.input}
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
          <button style={styles.clearBtn} onClick={handleClear} title="Clear (Esc)">
            <svg viewBox="0 0 16 16" fill="none" style={{ width: 10, height: 10 }}>
              <path d="M3 3l10 10M13 3L3 13" stroke="#475569" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        )}

        {/* Search button */}
        <button
          style={{ ...styles.searchBtn, ...(loading ? styles.searchBtnLoading : {}) }}
          onClick={handleSearch}
          disabled={loading}
          title="Search (Enter)"
        >
          <svg viewBox="0 0 16 16" fill="none" style={{ width: 13, height: 13 }}>
            <path d="M3 8h10M9 4l4 4-4 4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Hint row */}
      <div style={styles.hint}>
        <span>↵ search</span>
        <span>·</span>
        <span>esc clear</span>
        {hasQuery && (
          <>
            <span>·</span>
            <span style={{ color: '#6366f1' }}>"{searchQuery}"</span>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    padding: '14px 14px 10px',
    borderBottom: '1px solid #0a1a2e',
    background: 'linear-gradient(180deg, #060f20 0%, #050c1a 100%)',
  },
  labelRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },
  label: {
    fontSize: '10px',
    fontWeight: 700,
    color: '#1e3a5f',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
  },
  activeTag: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '9px',
    color: '#6366f1',
    fontWeight: 500,
  },
  activeDot: {
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: '#6366f1',
    boxShadow: '0 0 5px #6366f1',
    display: 'inline-block',
  },
  container: {
    display: 'flex',
    alignItems: 'center',
    background: '#07101f',
    border: '1px solid',
    borderRadius: '10px',
    padding: '3px 3px 3px 10px',
    transition: 'border-color 0.2s, box-shadow 0.2s',
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
    transition: 'stroke 0.2s',
  },
  spinner: {
    width: 15,
    height: 15,
    animation: 'spin 0.8s linear infinite',
  },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    padding: '8px 6px',
    color: '#e2e8f0',
    fontSize: '13px',
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
    background: '#0f1e35',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.15s',
  },
  searchBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
    border: 'none',
    borderRadius: '7px',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'opacity 0.15s, transform 0.1s',
    boxShadow: '0 2px 8px rgba(99,102,241,0.35)',
  },
  searchBtnLoading: {
    opacity: 0.5,
    cursor: 'not-allowed' as const,
  },
  hint: {
    display: 'flex',
    gap: '5px',
    marginTop: '6px',
    fontSize: '10px',
    color: '#1e3050',
    paddingLeft: '2px',
    overflow: 'hidden',
    whiteSpace: 'nowrap' as const,
    textOverflow: 'ellipsis',
  },
} as const;
