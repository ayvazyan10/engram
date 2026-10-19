import { create } from 'zustand';

/**
 * Colour mode: Auto follows the system, Light and Dark override it. The
 * choice is the `data-theme` attribute on <html> (tokens.css keys on it) and
 * is kept in localStorage; index.html applies it before the first paint.
 */
export type ColourMode = 'auto' | 'light' | 'dark';

export const COLOUR_MODE_KEY = 'engram.colourMode';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readMode(): ColourMode {
  try {
    const stored = localStorage.getItem(COLOUR_MODE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

function applyMode(mode: ColourMode): void {
  const root = document.documentElement;
  if (mode === 'auto') delete root.dataset.theme;
  else root.dataset.theme = mode;
}

interface ThemeState {
  mode: ColourMode;
  setMode: (mode: ColourMode) => void;
}

export const useTheme = create<ThemeState>((set) => ({
  mode: readMode(),
  setMode: (mode) => {
    try {
      if (mode === 'auto') localStorage.removeItem(COLOUR_MODE_KEY);
      else localStorage.setItem(COLOUR_MODE_KEY, mode);
    } catch {
      // Storage is blocked (private window): the choice lasts this visit.
    }
    applyMode(mode);
    set({ mode });
  },
}));

/** The scheme on screen: the reader's pick, or the system's under Auto. */
export function resolvedScheme(mode: ColourMode): 'light' | 'dark' {
  if (mode !== 'auto') return mode;
  return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
}

/** Applies the stored mode before the first render; CSS follows the system
 * while the mode is Auto. */
export function initTheme(): void {
  applyMode(useTheme.getState().mode);
}
