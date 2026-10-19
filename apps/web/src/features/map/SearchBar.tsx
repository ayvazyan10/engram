import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api.js';
import { asMemoryRecord } from '../../hooks/useWebSocket.js';
import { useMemoryStore, type MemoryRecord, type ProjectFilter } from '../../store/memoryStore.js';
import ScopeSwitch from '../../shell/ScopeSwitch.js';
import { Icon } from '../../shell/icons.js';

/** The search the field asks for, and the looser second pass when it finds
 *  fewer than three (questions in plain words often score under 0.3). */
const TOP_K = 20;
const WEAK_UNDER = 3;
const WEAK_TOP_K = 10;
const WEAK_THRESHOLD = 0.15;
/** Typing pauses this long before the search runs by itself. */
const TYPE_PAUSE_MS = 300;

const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl';

function records(rows: unknown[]): MemoryRecord[] {
  return rows.map(asMemoryRecord).filter((r): r is MemoryRecord => r !== null);
}

/**
 * One search with its fallback: when the server's usual threshold finds
 * fewer than three memories, ask once more with a lower one and return the
 * extra hits apart, as weaker matches.
 */
export async function searchWithFallback(
  query: string,
  scope: ProjectFilter
): Promise<{ strong: MemoryRecord[]; weaker: MemoryRecord[] }> {
  const strong = records((await api.search(query, TOP_K, undefined, scope)).results);
  if (strong.length >= WEAK_UNDER) return { strong, weaker: [] };
  const seen = new Set(strong.map((r) => r.id));
  const loose = records((await api.search(query, WEAK_TOP_K, undefined, scope, WEAK_THRESHOLD)).results);
  return { strong, weaker: loose.filter((r) => !seen.has(r.id)) };
}

/**
 * The Map's floating search field, with the project scope and the command
 * palette under it. It searches as you type (after a short pause) or at
 * once on Enter; Escape clears. A project change re-runs the search, and a
 * reply that a newer search has overtaken is dropped.
 */
export default function SearchBar({ onCommands }: { onCommands: () => void }) {
  const { searchQuery, isSearching, projectFilter, setSearchQuery, setSearchResults, setSearching, setHighlightedIds } =
    useMemoryStore();
  const [input, setInput] = useState(searchQuery);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef(0);
  const asked = useRef<string | null>(null);
  const pause = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPause = () => {
    if (pause.current) clearTimeout(pause.current);
    pause.current = null;
  };

  const run = useCallback(
    async (query: string) => {
      const id = ++latest.current;
      asked.current = query;
      setSearching(true);
      setError(null);
      try {
        const { strong, weaker } = await searchWithFallback(query, useMemoryStore.getState().projectFilter);
        if (id !== latest.current) return;
        // Committed together, and only on success, so a failed search never
        // relabels the last good results with its own words.
        setSearchQuery(query);
        setSearchResults(strong, weaker);
        setHighlightedIds(new Set([...strong, ...weaker].map((r) => r.id)));
      } catch (err) {
        if (id !== latest.current) return;
        setError(
          err instanceof ApiError && err.status === 0
            ? 'Search failed. Is the Engram server running?'
            : `Search failed: ${err instanceof Error ? err.message : 'unknown error'}`
        );
      } finally {
        if (id === latest.current) {
          asked.current = null;
          setSearching(false);
        }
      }
    },
    [setSearchQuery, setSearchResults, setSearching, setHighlightedIds]
  );

  const clear = useCallback(() => {
    clearPause();
    ++latest.current;
    asked.current = null;
    setInput('');
    setError(null);
    setSearching(false);
    setSearchQuery('');
    setSearchResults([]);
    setHighlightedIds(new Set());
  }, [setSearchQuery, setSearchResults, setSearching, setHighlightedIds]);

  const onChange = (value: string) => {
    setInput(value);
    clearPause();
    const query = value.trim();
    if (!query) {
      clear();
      return;
    }
    pause.current = setTimeout(() => {
      pause.current = null;
      if (query !== (asked.current ?? useMemoryStore.getState().searchQuery)) void run(query);
    }, TYPE_PAUSE_MS);
  };

  // A new scope asks the same question again of the new project.
  const scopeRef = useRef(projectFilter);
  useEffect(() => {
    if (scopeRef.current === projectFilter) return;
    scopeRef.current = projectFilter;
    const query = asked.current ?? useMemoryStore.getState().searchQuery;
    if (query) void run(query);
  }, [projectFilter, run]);

  useEffect(() => clearPause, []);

  return (
    <div className="mp-field" role="search">
      <div className="mp-q">
        {isSearching ? <span className="mp-spin" aria-hidden="true" /> : <Icon name="search" size={20} />}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const query = input.trim();
              clearPause();
              if (query && query !== asked.current) void run(query);
            } else if (e.key === 'Escape') {
              if (input) {
                e.preventDefault();
                clear();
              } else inputRef.current?.blur();
            }
          }}
          placeholder="Search your memories"
          aria-label="Search memories"
          aria-keyshortcuts="/"
          spellCheck={false}
          autoComplete="off"
        />
        {input ? (
          <button
            type="button"
            className="mp-clear"
            onClick={() => {
              clear();
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            title="Clear (Esc)"
          >
            <Icon name="close" size={16} />
          </button>
        ) : (
          <kbd aria-hidden="true" title="Press / to search">
            /
          </kbd>
        )}
      </div>
      <div className="mp-sub">
        <ScopeSwitch />
        <span className="mp-sub-note" role={error ? 'alert' : undefined}>
          {error}
        </span>
        <button type="button" className="at-cmd" onClick={onCommands} aria-keyshortcuts="Control+K Meta+K">
          <span className="at-cmd-keys" aria-hidden="true">
            <kbd>{MOD_KEY}</kbd>
            <kbd>K</kbd>
          </span>
          <span>Commands</span>
        </button>
      </div>
    </div>
  );
}
