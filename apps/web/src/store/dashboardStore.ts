import { create } from 'zustand';

/** 'home' is the landing view: search and the newest memories as cards. */
export type ViewMode = 'home' | '3d' | 'timeline' | 'analytics' | 'reflections';

interface DashboardState {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  viewMode: 'home',
  setViewMode: (mode) => set({ viewMode: mode }),
}));
