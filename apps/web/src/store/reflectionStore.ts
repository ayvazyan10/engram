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

export interface LLMStatus {
  provider: string;
  model: string;
  contextWindow: number;
  available: boolean;
}

interface ReflectionState {
  insights: ReflectionInsight[];
  llmStatus: LLMStatus | null;
  loading: boolean;
  reflecting: boolean;
  filterType: string | null;
  setInsights: (insights: ReflectionInsight[]) => void;
  setLLMStatus: (status: LLMStatus) => void;
  setLoading: (loading: boolean) => void;
  setReflecting: (reflecting: boolean) => void;
  setFilterType: (type: string | null) => void;
  addInsights: (insights: ReflectionInsight[]) => void;
}

export const useReflectionStore = create<ReflectionState>((set) => ({
  insights: [],
  llmStatus: null,
  loading: false,
  reflecting: false,
  filterType: null,
  setInsights: (insights) => set({ insights }),
  setLLMStatus: (status) => set({ llmStatus: status }),
  setLoading: (loading) => set({ loading }),
  setReflecting: (reflecting) => set({ reflecting }),
  setFilterType: (type) => set({ filterType: type }),
  addInsights: (newInsights) =>
    set((state) => ({ insights: [...newInsights, ...state.insights] })),
}));
