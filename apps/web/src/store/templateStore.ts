import { create } from 'zustand';

/**
 * The full colour + interaction-state contract every themed surface reads
 * from. Extended (design audit V5) from the original 15-field colour-only
 * shape to also cover the accent pairing a solid CTA button needs
 * (accentStrong/onAccent — see the comment above the Neural entry for why
 * that split exists) and the interaction overlays hover/focus/active need
 * (V1/V2) so no component has to invent its own.
 */
export interface UITemplate {
  id: string;
  name: string;
  /** Header */
  headerBg: string;
  headerBorder: string;
  /** Sidebar + Inspector */
  panelBg: string;
  panelBorder: string;
  /** Root background */
  rootBg: string;
  /** Text colors — primary (body/headings), secondary (supporting copy),
   *  muted (labels/counters/hints). All three must clear 4.5:1 against
   *  rootBg/panelBg/cardBg; muted is the lowest tier that still qualifies,
   *  not "as dark as looks fine at a glance" (that was the V4 bug). */
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  /** Accent — used for rings, small text/icon accents, borders. Must clear
   *  3:1 against rootBg (non-text / focus-indicator threshold). */
  accent: string;
  accentGlow: string;
  /** Accent, deepened — used as a *solid* CTA button fill. `accent` alone is
   *  too light to give onAccent text 4.5:1 on some templates (Neural's
   *  #6366f1 <-> white text lands at ~4.47:1, just under AA; Midnight's
   *  #a855f7 <-> white lands at ~3.96:1, failing outright). accentStrong is
   *  the shade that keeps CTA copy legible. */
  accentStrong: string;
  /** Text/icon colour to place on top of accent / accentStrong fills. */
  onAccent: string;
  /** Input / card backgrounds */
  inputBg: string;
  cardBg: string;
  /** Status bar */
  statusBg: string;
  /** Interaction states (V1) — painted via box-shadow/filter, never by
   *  fighting an element's own inline `background`. See global.css's
   *  .ec-hover-tint / .ec-hover-bright. */
  hoverOverlay: string;
  activeOverlay: string;
  /** focus-visible ring colour (V2). Equal to `accent` today; kept as its
   *  own field so a template can diverge without every component changing. */
  focusRing: string;
}

export const TEMPLATES: UITemplate[] = [
  {
    id: 'neural',
    name: 'Neural',
    headerBg: '#040d1e',
    headerBorder: '#0f2040',
    panelBg: '#060e1e',
    panelBorder: '#0f2040',
    rootBg: '#020817',
    textPrimary: '#e2e8f0',
    textSecondary: '#94a3b8',
    // Was '#334155' (~1.9:1 on rootBg/panelBg — the V4 defect). '#7b8ca3'
    // clears ~5.8:1 against rootBg while staying visibly a step down from
    // textSecondary's ~7.8:1.
    textMuted: '#7b8ca3',
    accent: '#6366f1',
    accentGlow: 'rgba(99,102,241,0.35)',
    accentStrong: '#4f46e5',
    onAccent: '#ffffff',
    inputBg: '#07101f',
    cardBg: '#0a1628',
    statusBg: '#030810',
    hoverOverlay: 'rgba(255,255,255,0.06)',
    activeOverlay: 'rgba(0,0,0,0.18)',
    focusRing: '#6366f1',
  },
  {
    id: 'vercel',
    name: 'Mono',
    headerBg: '#000000',
    headerBorder: '#1a1a1a',
    panelBg: '#0a0a0a',
    panelBorder: '#1a1a1a',
    rootBg: '#000000',
    textPrimary: '#ededed',
    textSecondary: '#888888',
    // Was '#444444' (~2.2:1 on pure black). textMuted also has to clear
    // 4.5:1 against cardBg ('#171717', the lightest surface it's painted on
    // — e.g. AnalyticsView's StatCard label) which is the binding
    // constraint, not rootBg: '#868686' clears ~4.9:1 there (~5.8:1 on
    // rootBg).
    textMuted: '#868686',
    accent: '#ffffff',
    accentGlow: 'rgba(255,255,255,0.15)',
    // Mono's accent is already maximally light — accentStrong stays white,
    // and onAccent goes dark instead (the inverse of the other two templates).
    accentStrong: '#ffffff',
    onAccent: '#0a0a0a',
    inputBg: '#111111',
    cardBg: '#171717',
    statusBg: '#000000',
    hoverOverlay: 'rgba(255,255,255,0.08)',
    activeOverlay: 'rgba(0,0,0,0.25)',
    focusRing: '#ffffff',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    headerBg: '#0c0014',
    headerBorder: '#1a0a30',
    panelBg: '#0e0018',
    panelBorder: '#1a0a30',
    rootBg: '#080010',
    textPrimary: '#e0d4f5',
    textSecondary: '#9b8ab8',
    // Was '#3d2d5c' (~1.7:1 on rootBg). '#8f7fae' clears ~5.7:1.
    textMuted: '#8f7fae',
    accent: '#a855f7',
    accentGlow: 'rgba(168,85,247,0.35)',
    accentStrong: '#7e22ce',
    onAccent: '#ffffff',
    inputBg: '#110020',
    cardBg: '#150028',
    statusBg: '#060010',
    hoverOverlay: 'rgba(255,255,255,0.07)',
    activeOverlay: 'rgba(0,0,0,0.22)',
    focusRing: '#a855f7',
  },
];

interface TemplateState {
  activeTemplate: UITemplate;
  setTemplate: (id: string) => void;
}

export const useTemplateStore = create<TemplateState>((set) => ({
  activeTemplate: TEMPLATES[0]!,
  setTemplate: (id) => {
    const t = TEMPLATES.find((t) => t.id === id);
    if (t) set({ activeTemplate: t });
  },
}));
