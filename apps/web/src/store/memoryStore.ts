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
}

interface MemoryState {
  records: MemoryRecord[];
  searchResults: MemoryRecord[];
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
  currentContext: string;
  recallLatencyMs: number | null;
  highlightedIds: Set<string>;

  setRecords: (records: MemoryRecord[]) => void;
  setSearchResults: (results: MemoryRecord[]) => void;
  setSearchQuery: (query: string) => void;
  setSearching: (searching: boolean) => void;
  setContext: (context: string, latencyMs: number) => void;
  setHighlightedIds: (ids: Set<string>) => void;
  addRecord: (record: MemoryRecord) => void;
  removeRecord: (id: string) => void;
  /** Persist a tag edit into the record so re-selecting it doesn't show stale tags. */
  updateRecordTags: (id: string, tags: string[]) => void;
}

export const useMemoryStore = create<MemoryState>((set) => ({
  records: [],
  searchResults: [],
  searchQuery: '',
  isSearching: false,
  loadedCount: 0,
  currentContext: '',
  recallLatencyMs: null,
  highlightedIds: new Set(),

  setRecords: (records) => set({ records, loadedCount: records.length }),
  setSearchResults: (results) => set({ searchResults: results }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearching: (searching) => set({ isSearching: searching }),
  setContext: (context, latencyMs) => set({ currentContext: context, recallLatencyMs: latencyMs }),
  setHighlightedIds: (ids) => set({ highlightedIds: ids }),
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
      return {
        records: [record, ...state.records],
        loadedCount: state.loadedCount + 1,
      };
    }),
  removeRecord: (id) =>
    set((state) => ({
      records: state.records.filter((r) => r.id !== id),
      loadedCount: Math.max(0, state.loadedCount - 1),
    })),
  updateRecordTags: (id, tags) =>
    set((state) => ({
      records: state.records.map((r) =>
        r.id === id ? { ...r, tags: JSON.stringify(tags) } : r
      ),
    })),
}));
