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
  totalCount: number;
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
}

export const useMemoryStore = create<MemoryState>((set) => ({
  records: [],
  searchResults: [],
  searchQuery: '',
  isSearching: false,
  totalCount: 0,
  currentContext: '',
  recallLatencyMs: null,
  highlightedIds: new Set(),

  setRecords: (records) => set({ records, totalCount: records.length }),
  setSearchResults: (results) => set({ searchResults: results }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearching: (searching) => set({ isSearching: searching }),
  setContext: (context, latencyMs) => set({ currentContext: context, recallLatencyMs: latencyMs }),
  setHighlightedIds: (ids) => set({ highlightedIds: ids }),
  addRecord: (record) =>
    set((state) => ({
      records: [record, ...state.records],
      totalCount: state.totalCount + 1,
    })),
  removeRecord: (id) =>
    set((state) => ({
      records: state.records.filter((r) => r.id !== id),
      totalCount: Math.max(0, state.totalCount - 1),
    })),
}));
