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

// ─── Memory-type colour — the categorical palette (F1) ─────────────────────
//
// Memory type is the app's one categorical variable, so these three are the
// only slots that encode identity. They are constant across templates on
// purpose: an episodic memory is episodic whichever skin is on.
//
// V5 consolidated four disagreeing copies of this map onto one; the values it
// settled on ('#818cf8' / '#22d3ee' / '#fbbf24') were picked for WCAG contrast
// alone and failed the data-viz lightness band outright — OKLCH L 0.680 /
// 0.797 / 0.837 against a dark-mode band of L ∈ [0.48, 0.67]. All three sat
// ABOVE the band and spanned 0.157 of lightness, so amber outranked indigo on
// brightness whatever the two meant; on a graph where brightness separately
// encodes recency, that is the identity channel leaking into the magnitude one.
//
// These three were derived by the data-viz skill's snap-to-passing procedure —
// same three hue families, re-stepped into the band:
//
//   episodic   #7e6cf8  L 0.621  C 0.201  H 284.7   (violet)
//   semantic   #22a5b0  L 0.661  C 0.106  H 203.8   (teal)
//   procedural #be861d  L 0.660  C 0.130  H  77.0   (amber)
//
// Lightness span 0.157 → 0.041. `validate_palette.js --mode dark --pairs all`
// passes every check on all five distinct surfaces the app paints them on
// (worst all-pairs CVD ΔE 16.3 deutan, normal-vision ΔE 21.1). `--pairs all`
// rather than the adjacent pairlist because the 3D scene is a scatter: any two
// nodes can end up side by side.
//
// The WCAG invariant V5 bought is kept in substance, not just in name: the
// minimum contrast across every surface of every template is 4.60:1 (episodic
// on Mono's cardBg), so all three still clear 4.5:1 — see tokens.test.ts.
export const TYPE_COLORS = {
  episodic: '#7e6cf8',
  semantic: '#22a5b0',
  procedural: '#be861d',
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
  // Compact-viewport panes (the mobile tab bar)
  //
  // Own entries rather than borrowed ones: the tab bar used to hard-code
  // '⬡' for Graph and '◈' for Inspect, which are this registry's
  // `concept` and `pattern` — exactly the one-glyph-two-meanings collision
  // it exists to prevent. '☰' (stacked rules → the record list) was already
  // unclaimed and is kept.
  paneMemories: '☰',
  paneGraph: '⊛',
  paneInspect: '⊡',
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

// ─── Reflection insight colour — deliberately absent (F5) ───────────────────
//
// There used to be a REFLECTION_COLORS map here, and three of its four slots
// were BYTE-IDENTICAL to TYPE_COLORS: pattern === episodic ('#818cf8'), trend
// === semantic ('#22d3ee'), contradiction_summary === procedural ('#fbbf24'),
// ΔE 0.0. One categorical slot cannot own two identities, and these two sets
// genuinely co-occur — a stored reflection is also a memory, so it carries a
// type badge in the timeline and a type hue in the 3D scene at the same time
// as its insight chip. A violet "Pattern" chip beside a violet "episodic"
// badge is not a near miss; it is the same colour meaning two things.
//
// Resolved by dropping the colour rather than re-slotting it. Reasons:
//
//   1. A second four-slot categorical set puts seven meaning-carrying colour
//      classes on one app, which is past the point where adjacent classes
//      blur (dataviz `choosing-a-form.md`).
//   2. Reflections are never plotted. ReflectionView is a card list, and every
//      card already spells the type out in words next to a distinct glyph
//      (GLYPH.pattern / knowledgeGap / trend / contradiction). Colour was
//      restating a label that was already there.
//   3. Those hexes were being used as TEXT colour on the chip and the filter
//      button, which the mark rules forbid outright.
//
// The type filter buttons and the card chip now use the same neutral
// (textPrimary / textSecondary on a template surface) treatment as every other
// non-data chip in the app, with the glyph carrying identity. See
// tokens.test.ts, which now asserts no two data-colour sets collide.

// ─── Data-mark colour (F4/F5) ───────────────────────────────────────────────
//
// The analytics charts had no data colour of their own: the growth area, the
// source bars and the heatmap all painted with `t.accent` — the *chrome*
// token that also draws focus rings, timeline date headings and scrollbars.
// With TYPE_COLORS in play on the same page, Neural's indigo meant "episodic",
// "source volume", "growth" and "activity magnitude" at once.
//
// One measure runs through all three of those charts: the number of memories.
// So it gets one hue, distinct from every type slot and every status role, and
// used two ways — a flat slot for single-series charts and a sequential ramp
// for magnitude. Both are template-independent for the same reason TYPE_COLORS
// and STATUS are: what a mark means must not change when the skin does.
//
// Hue was chosen by search, not by taste: with the three type hues at 284.7 /
// 203.8 / 77.0 and the status roles occupying red, amber, green and sky, the
// only families left clearing ΔE >= 15 (normal vision) from all of them are
// magenta/rose. H ~340 is the pick.
export const SERIES = {
  /**
   * Slot 1 — the colour of "a memory was stored". Used for every single-series
   * chart (growth area, source bars), which is what the data-viz form rules
   * prescribe for nominal categories: one series, one hue, no legend box (the
   * panel title names it).
   *
   * `#b04592` — OKLCH L 0.559 C 0.166 H 340, inside the dark categorical band,
   * >= 3:1 on every template surface (3.51:1 worst, Mono cardBg), ΔE 18.3
   * normal / 9.4 CVD from the nearest TYPE_COLOR. It is ACTIVITY_RAMP's second
   * step, so the flat series and the ramp read as one family.
   */
  primary: '#b04592',
} as const;

/**
 * Sequential ramp for activity magnitude — one hue, monotone lightness (F4).
 *
 * Replaces `withAlpha(t.accent, 0.15 + intensity * 0.85)`, which was an opacity
 * ramp over whichever accent the active template supplied, with no lightness
 * discipline at all. Composited on Neural's cardBg the count-1 cell landed at
 * 1.41:1 and count 0 at 1.05:1 — invisible; Midnight measured 1.45:1 / 1.02:1.
 * Mono passed only because its accent is white, so legibility was an accident
 * of which template was active.
 *
 * Dark mode inverts the ramp's anchor: more is LIGHTER, away from the surface.
 * `validate_palette.js --ordinal --mode dark` passes on all three card
 * surfaces — monotone L (0.469 / 0.559 / 0.649 / 0.739), every adjacent ΔL
 * 0.09 (floor 0.06), hue spread 0°, and a low end at 2.43:1 against the worst
 * surface (floor 2.0:1).
 */
export const ACTIVITY_RAMP = ['#883871', '#b04592', '#d35bb1', '#e882c8'] as const;

/**
 * Neutral sequential ramp for edge strength in the 3D scene (F5).
 *
 * ConnectionLine used a blue ramp whose mid step sat ΔE 9.3 from the episodic
 * hue — under the normal-vision floor of 15, i.e. a magnitude scale wearing a
 * near-miss of a categorical slot. Edge strength is magnitude, so it belongs on
 * a neutral ramp that cannot be mistaken for anyone's identity.
 *
 * H 250 at C 0.012 — grey enough to carry no identity, chromatic enough that the
 * hue stays stable across the three steps (the ordinal single-hue check needs a
 * defined hue). `--ordinal --mode dark` passes on all three scene backgrounds:
 * monotone L 0.405 / 0.475 / 0.545, ΔL 0.070, hue spread 5°, low end 2.23:1.
 *
 * It sits low in the range on purpose. A grey and the semantic teal (the lowest-
 * chroma type slot, OKLCH C 0.106) collide on ΔE when their LIGHTNESS is close —
 * a brighter ramp measured 10.2 from it, under the same normal-vision floor of
 * 15 the blue ramp failed. Holding every step under L 0.55 clears it at 15.1,
 * and it is the right hierarchy anyway: 3,099 edges are context for 651 nodes,
 * so they recede.
 *
 * The material this draws with is now OPAQUE. At `opacity: 0.7` no ramp could
 * satisfy both that ΔE floor and the ordinal low-end floor once composited —
 * and the transparency was carrying an unstated fourth channel besides, since
 * overlapping edges accumulated alpha and a dense region read brighter than a
 * sparse one with nothing in the key saying so. Opaque means the step a reader
 * sees is the step the key defines.
 */
export const EDGE_RAMP = ['#444a4f', '#575d63', '#6b7177'] as const;

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

/** '#rrggbb' -> linear-light sRGB channels in 0-1. */
function linearChannels(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const toLinear = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [
    toLinear(parseInt(full.slice(0, 2), 16)),
    toLinear(parseInt(full.slice(2, 4), 16)),
    toLinear(parseInt(full.slice(4, 6), 16)),
  ];
}

export interface Oklab {
  L: number;
  a: number;
  b: number;
}

/**
 * OKLab coordinates of a '#rrggbb' colour (Björn Ottosson's matrices).
 *
 * WCAG contrast answers "can this be read"; it does not answer "do these two
 * colours read as the same thing", and it does not answer "is this slot inside
 * the perceptual lightness band". Both of those were live defects — three
 * memory-type hues spanning 0.157 of OKLCH lightness, and a reflection palette
 * byte-identical to the memory-type one — so the repo owns the measure rather
 * than asserting the audit's numbers by hand. Same role `contrastRatio` plays
 * for the template text roles.
 */
export function oklab(hex: string): Oklab {
  const [r, g, b] = linearChannels(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}

/** OKLCH lightness — the axis the dark-mode band is defined on. */
export function oklchLightness(hex: string): number {
  return oklab(hex).L;
}

/** OKLCH chroma. Below ~0.10 a hue reads as grey and stops doing identity work. */
export function oklchChroma(hex: string): number {
  const { a, b } = oklab(hex);
  return Math.hypot(a, b);
}

/** Euclidean distance in OKLab, ×100 — the ΔE this project's colour rules use. */
export function deltaE(hexA: string, hexB: string): number {
  const A = oklab(hexA);
  const B = oklab(hexB);
  return 100 * Math.hypot(A.L - B.L, A.a - B.a, A.b - B.b);
}

/** The dark-mode lightness band a categorical slot has to sit inside. */
export const DARK_LIGHTNESS_BAND = { min: 0.48, max: 0.67 } as const;

/** Chroma floor for a categorical slot. */
export const CHROMA_FLOOR = 0.1;

/** Below this ΔE, full-colour readers cannot reliably tell two data colours
 *  apart — so no two colours that mean different things may sit under it. */
export const NORMAL_VISION_DELTA_E_FLOOR = 15;

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
