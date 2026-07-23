import { create } from 'zustand';

export interface ReflectionInsight {
  id: string;
  type: string;
  content: string;
  importance: number;
  confidence: number;
  tags: string[];
  createdAt: string;
}

export interface ReflectionStatus {
  enabled: boolean;
  due: boolean;
  counter: number;
  threshold: number;
}

interface ReflectionState {
  insights: ReflectionInsight[];
  status: ReflectionStatus | null;
  loading: boolean;
  filterType: string | null;
  error: string | null;
  setInsights: (insights: ReflectionInsight[]) => void;
  setStatus: (status: ReflectionStatus) => void;
  setLoading: (loading: boolean) => void;
  setFilterType: (type: string | null) => void;
  setError: (error: string | null) => void;
}

export const useReflectionStore = create<ReflectionState>((set) => ({
  insights: [],
  status: null,
  loading: false,
  filterType: null,
  error: null,
  setInsights: (insights) => set({ insights }),
  setStatus: (status) => set({ status }),
  setLoading: (loading) => set({ loading }),
  setFilterType: (type) => set({ filterType: type }),
  setError: (error) => set({ error }),
}));
