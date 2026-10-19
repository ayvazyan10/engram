import { create } from 'zustand';
import { useTemplateStore, type UITemplate } from '../store/templateStore.js';

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
  bridgeTemplate();
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

/**
 * Temporary bridge (deleted in F6): the views F2–F6 have not replaced yet read
 * colours from the old `UITemplate` object and mix them with `withAlpha(hex)`.
 * This builds that object from the live Atlas tokens, as hex, so those views
 * paint in the Atlas palette and follow the colour mode. Null when tokens.css
 * is not applied (jsdom), which leaves the store's template alone.
 */
export function templateFromTokens(): UITemplate | null {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  if (!token('--paper')) return null;
  return {
    id: 'atlas',
    name: 'Atlas',
    headerBg: token('--surface'),
    headerBorder: token('--rule'),
    panelBg: token('--surface'),
    panelBorder: token('--rule'),
    rootBg: token('--paper'),
    textPrimary: token('--ink'),
    textSecondary: token('--ink-2'),
    textMuted: token('--ink-3'),
    accent: token('--ink'),
    accentGlow: token('--wash-2'),
    accentStrong: token('--ink'),
    onAccent: token('--on-ink'),
    inputBg: token('--raised'),
    cardBg: token('--raised'),
    statusBg: token('--surface'),
    hoverOverlay: token('--wash'),
    activeOverlay: token('--wash-2'),
    focusRing: token('--focus'),
  };
}

function bridgeTemplate(): void {
  const template = templateFromTokens();
  if (template) useTemplateStore.setState({ activeTemplate: template });
}

/** Applies the stored mode and follows the system while the mode is Auto.
 *  Called once from main.tsx, before the first render. */
export function initTheme(): void {
  applyMode(useTheme.getState().mode);
  window.matchMedia?.(DARK_QUERY).addEventListener('change', bridgeTemplate);
}
