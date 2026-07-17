import { create } from 'zustand';

export type ViewMode = '3d' | 'timeline' | 'analytics' | 'reflections';

interface DashboardState {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  viewMode: '3d',
  setViewMode: (mode) => set({ viewMode: mode }),
}));
