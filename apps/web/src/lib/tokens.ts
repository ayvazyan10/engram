/**
 * Design tokens shared by every surface in the dashboard.
 *
 * This is the single source of truth the design audit asked for: colour
 * (memory-type + status), spacing, radius, and type scale all live here so
 * components stop re-declaring the same literals (and disagreeing on them —
 * see TYPE_COLORS below). Template-specific colour (per Neural/Mono/Midnight
 * skin) still lives in `templateStore.ts`; this module holds the values that
 * are the same regardless of which template is active.
 */

// ─── Memory-type colour (V5 consolidation) ─────────────────────────────────
//
// Previously duplicated across MemoryPanel.tsx, NeuronInspector.tsx (both
// '#6366f1' for episodic) and AnalyticsView.tsx / TimelineView.tsx (both
// '#818cf8') — the same memory rendered a different colour depending which
// panel you looked at. '#818cf8' (indigo-400) wins: it's what the default 3D
// view (viewStore.ts 'cosmos') already used, and it's the one that actually
// clears 4.5:1 against the app's near-black surfaces — '#6366f1' (indigo-500)
// only reaches ~4.0-4.3:1 on panelBg/cardBg, see tokens.contrast.test.ts.
export const TYPE_COLORS = {
  episodic: '#818cf8',
  semantic: '#22d3ee',
  procedural: '#fbbf24',
} as const;

export type MemoryType = keyof typeof TYPE_COLORS;

// ─── Glyphs (L6) ────────────────────────────────────────────────────────────
//
// The app drew its icons from six Unicode repertoires at once — colour emoji
// (🕐 💡 ⚙️ 🔒) sitting beside monochrome line glyphs — and reused the same
// glyph for unrelated meanings: '⬡' meant "contradiction summary" in
// ReflectionView, "concept" on a timeline card, AND "nothing selected" in the
// inspector; '◆' meant both "semantic memory" and "trend".
//
// The real fix is one drawn icon set, but that costs bundle the app doesn't
// have (two components already hand-roll ~100-byte inline SVG paths instead —
// see NeuronInspector's archive/close buttons and SearchBar's magnifier).
// The zero-cost interim rule, applied here: ONE glyph per meaning, no glyph
// reused for two meanings, and no colour emoji anywhere — so a glyph is at
// least never actively misleading.
export const GLYPH = {
  // Memory types
  episodic: '◷',
  semantic: '◆',
  procedural: '⚙',
  // Reflection insight types
  pattern: '◈',
  knowledgeGap: '◇',
  trend: '↗',
  contradiction: '⊗',
  // Record fields
  concept: '⬡',
  importance: '◉',
  confidence: '◎',
  // States
  empty: '⊘',
  nothingSelected: '◌',
  warning: '⚠',
  contextLoaded: '⧉',
} as const;

export const TYPE_ICONS: Record<MemoryType, string> = {
  episodic: GLYPH.episodic,
  semantic: GLYPH.semantic,
  procedural: GLYPH.procedural,
};

export const TYPE_LABELS: Record<MemoryType, string> = {
  episodic: 'Episodic',
  semantic: 'Semantic',
  procedural: 'Procedural',
};

// ─── Status colour ──────────────────────────────────────────────────────────
//
// Semantic (danger/success/…) — kept constant across templates on purpose,
// same reasoning as TYPE_COLORS: a red error means "error" whether the skin
// is Neural, Mono or Midnight.
export const STATUS = {
  danger: '#f87171',
  success: '#22c55e',
  warning: '#f59e0b',
  info: '#38bdf8',
  contradiction: '#fb923c',
} as const;

/** Text/icon colour to place on top of a *solid* STATUS fill — the archive
 *  confirmation's destructive button is the only one so far. STATUS colours
 *  are all light, so this is the dark side of the pair; asserted at 4.5:1
 *  against its fill in tokens.test.ts, the same way template text roles are
 *  asserted against their surfaces. */
export const ON_STATUS = {
  danger: '#1c0606',
} as const;

// ─── Reflection insight colour ──────────────────────────────────────────────
//
// Four hex literals lived inline in ReflectionView's TYPE_META. Same
// reasoning as TYPE_COLORS and STATUS: constant across templates (a
// contradiction is a contradiction whichever skin is on), and named here so
// they are covered by the contrast sweep in tokens.test.ts rather than being
// four values nobody ever checked.
export const REFLECTION_COLORS = {
  pattern: '#818cf8',
  knowledge_gap: '#f472b6',
  trend: '#22d3ee',
  contradiction_summary: '#fbbf24',
} as const;

// ─── Spacing scale ──────────────────────────────────────────────────────────
export const SPACE = {
  '3xs': '2px',
  '2xs': '4px',
  xs: '6px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  '2xl': '28px',
  '3xl': '40px',
} as const;

// ─── Radius scale ───────────────────────────────────────────────────────────
//
// Was 11 distinct values from 1-14px with no logic to which element got
// which. Three tiers now: tight (chips/badges/small controls), standard
// (buttons/inputs/rows), loose (cards/panels/modals), plus pill for fully
// round controls.
export const RADIUS = {
  tight: '4px',
  sm: '6px',
  md: '8px',
  lg: '10px',
  xl: '14px',
  pill: '999px',
} as const;

// ─── Type scale ─────────────────────────────────────────────────────────────
//
// Was 12 distinct font sizes from 9-36px. Named steps instead — every
// component picks a step rather than inventing a new pixel value.
export const TYPE = {
  micro: '9px',
  xs: '10px',
  sm: '11px',
  base: '12px',
  md: '13px',
  lg: '14px',
  xl: '16px',
  '2xl': '18px',
  display: '24px',
  /** Decorative glyph in an empty state — not text, and the only step above
   *  `display`. Named so it stops being a one-off literal. */
  glyph: '32px',
} as const;

// ─── Measure ────────────────────────────────────────────────────────────────
//
// H3: ReflectionView's body ran the full width of the card — 1330px at 13px,
// about 205 characters per line, where readable measure is 45-75. The card
// itself stays full width (its badge/date row and footer still span); only
// the running text is capped.
export const MEASURE = {
  /** ~68 characters — inside the 45-75 band, and wide enough that a short
   *  reflection still fills its line rather than looking orphaned. */
  readable: '68ch',
} as const;

export const WEIGHT = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

// ─── Motion ─────────────────────────────────────────────────────────────────
export const DURATION = {
  fast: '120ms',
  normal: '200ms',
} as const;

export const EASING = {
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

// ─── Colour helpers ─────────────────────────────────────────────────────────

/** '#rrggbb' + alpha (0-1) -> 'rgba(r, g, b, a)'. Safer than the
 *  '#rrggbb' + '20' string-concat trick used throughout the codebase, which
 *  silently produces garbage for any accent that isn't exactly 6 hex digits
 *  (e.g. the Mono template's '#ffffff' still works by luck, but this doesn't
 *  rely on luck). */
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** '#rrggbb' -> 0xrrggbb, for three.js material colours. Lets viewStore.ts
 *  reference TYPE_COLORS directly instead of re-typing the same hex as a
 *  numeric literal. */
export function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/** WCAG 2.x relative luminance of a '#rrggbb' colour. */
export function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = channel(parseInt(full.slice(0, 2), 16));
  const g = channel(parseInt(full.slice(2, 4), 16));
  const b = channel(parseInt(full.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two '#rrggbb' colours, 1-21. This is the
 *  function the honest V4 proof runs against the template tokens — see
 *  tokens.contrast.test.ts. */
export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}
