import { create } from 'zustand';

export interface MemoryRecord {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural';
  content: string;
  summary: string | null;
  importance: number;
  source: string | null;
  concept: string | null;
  tags: string;
  createdAt: string;
  /** The project this memory belongs to: an absolute git-root path, or null
   *  (or absent, from an older server) for a global memory. */
  namespace?: string | null;
  /** How often recall has handed this memory to an AI, and when it last did.
   *  Full rows carry them (GET /graph/:id); a list page may not. */
  accessCount?: number;
  lastAccessedAt?: string | null;
}

/** Which memories Home lists: `undefined` is every one, `null` the global
 *  ones, a path one project's. The same three meanings `namespace` has. */
export type ProjectFilter = string | null | undefined;

interface MemoryState {
  records: MemoryRecord[];
  searchResults: MemoryRecord[];
  /** When the search found fewer than three, the hits a second, looser pass
   *  added. Listed apart, under "Weaker matches". */
  weakerResults: MemoryRecord[];
  searchQuery: string;
  isSearching: boolean;
  /**
   * How many records are LOADED, not how many the store holds. The dashboard
   * fetches one page (`api.listMemories({ limit: 200 })`) and the server caps
   * that page at 200, so on a 651-memory store this reads 200 — which is why
   * the field is no longer named for a total: the status bar read it as one
   * and reported 200 memories out of 651.
   *
   * The real census is `lib/serverStats.ts` (GET /stats). This number stays
   * because the increment on add and the decrement on remove are meaningful
   * for it — a record arriving over the socket really does join the loaded
   * page — and they would be wrong for a store-wide total the client never
   * fetched.
   */
  loadedCount: number;
  highlightedIds: Set<string>;
  /** Memories archived a moment ago whose call waits out the undo window:
   *  every list leaves them out until it is sent or undone. */
  hiddenIds: ReadonlySet<string>;
  /**
   * Bumped when a memory joins or leaves the STORE (a socket arrival, an
   * archive) — not when the dashboard merely loads another page of it. The
   * whole-store fetches (plate data, contradictions) key on this, so paging
   * through the list does not refetch them and the cold load fetches once.
   */
  storeChanges: number;
  /** The global project scope. The shell reloads the list and SearchBar
   *  refreshes an active search when it changes; leaving a route keeps it. */
  projectFilter: ProjectFilter;

  setProjectFilter: (filter: ProjectFilter) => void;
  setRecords: (records: MemoryRecord[]) => void;
  setSearchResults: (results: MemoryRecord[], weaker?: MemoryRecord[]) => void;
  setSearchQuery: (query: string) => void;
  setSearching: (searching: boolean) => void;
  setHighlightedIds: (ids: Set<string>) => void;
  setHidden: (id: string, hidden: boolean) => void;
  /** The next page of the list, appended. Rows already present (a socket
   *  arrival shifts the server's offsets) are skipped. */
  appendRecords: (records: MemoryRecord[]) => void;
  addRecord: (record: MemoryRecord) => void;
  removeRecord: (id: string) => void;
  /** Persist a tag edit into the record so re-selecting it doesn't show stale tags. */
  updateRecordTags: (id: string, tags: string[]) => void;
  /** An edited record, as the server returned it, replacing its old copy in
   *  the list and in the search results. */
  updateRecord: (record: MemoryRecord) => void;
}

export const useMemoryStore = create<MemoryState>((set) => ({
  records: [],
  searchResults: [],
  weakerResults: [],
  searchQuery: '',
  isSearching: false,
  loadedCount: 0,
  highlightedIds: new Set(),
  hiddenIds: new Set(),
  storeChanges: 0,
  projectFilter: undefined,

  setProjectFilter: (filter) => set({ projectFilter: filter }),
  setRecords: (records) => set({ records, loadedCount: records.length }),
  setSearchResults: (results, weaker = []) => set({ searchResults: results, weakerResults: weaker }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearching: (searching) => set({ isSearching: searching }),
  setHighlightedIds: (ids) => set({ highlightedIds: ids }),
  setHidden: (id, hidden) =>
    set((state) => {
      const hiddenIds = new Set(state.hiddenIds);
      if (hidden) hiddenIds.add(id);
      else hiddenIds.delete(id);
      return { hiddenIds };
    }),
  appendRecords: (page) =>
    set((state) => {
      const known = new Set(state.records.map((r) => r.id));
      const records = [...state.records, ...page.filter((r) => !known.has(r.id))];
      return { records, loadedCount: records.length };
    }),
  // Idempotent by id: the modal's onStored callback and the server's
  // 'memory:stored' broadcast both call this for the same POST, and either
  // can arrive first. A duplicate arrival replaces the existing entry
  // in-place (picking up any newer fields) instead of prepending a second
  // copy — see F1.
  addRecord: (record) =>
    set((state) => {
      const index = state.records.findIndex((r) => r.id === record.id);
      if (index !== -1) {
        const records = [...state.records];
        records[index] = record;
        return { records };
      }
      // A memory from another project still changes the store, but it does
      // not join a list filtered to one project.
      const filter = state.projectFilter;
      if (filter !== undefined && (record.namespace ?? null) !== filter) {
        return { storeChanges: state.storeChanges + 1 };
      }
      return {
        records: [record, ...state.records],
        loadedCount: state.loadedCount + 1,
        storeChanges: state.storeChanges + 1,
      };
    }),
  removeRecord: (id) =>
    set((state) => ({
      records: state.records.filter((r) => r.id !== id),
      searchResults: state.searchResults.filter((r) => r.id !== id),
      weakerResults: state.weakerResults.filter((r) => r.id !== id),
      loadedCount: Math.max(0, state.loadedCount - 1),
      storeChanges: state.storeChanges + 1,
    })),
  updateRecordTags: (id, tags) =>
    set((state) => ({
      records: state.records.map((r) =>
        r.id === id ? { ...r, tags: JSON.stringify(tags) } : r
      ),
    })),
  updateRecord: (record) =>
    set((state) => ({
      records: state.records.map((r) => (r.id === record.id ? record : r)),
      searchResults: state.searchResults.map((r) => (r.id === record.id ? record : r)),
      weakerResults: state.weakerResults.map((r) => (r.id === record.id ? record : r)),
    })),
}));
