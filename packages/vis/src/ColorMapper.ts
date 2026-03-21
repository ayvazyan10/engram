/**
 * ColorMapper — maps activation levels (0.0–1.0) to HSL colors.
 *
 * Cold (0.0) = deep blue (#1a237e)
 * Neutral (0.5) = teal (#00897b)
 * Hot (1.0) = orange-red (#e64a19)
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

const GRADIENT = [
  { pos: 0.0, h: 240, s: 70, l: 30 },  // deep blue
  { pos: 0.3, h: 195, s: 80, l: 40 },  // cyan
  { pos: 0.5, h: 160, s: 75, l: 40 },  // teal
  { pos: 0.7, h: 45,  s: 90, l: 50 },  // yellow-orange
  { pos: 1.0, h: 15,  s: 85, l: 45 },  // deep orange
];

export class ColorMapper {
  /**
   * Map activation (0.0–1.0) to a hex color string.
   */
  static toHex(activation: number): string {
    const { r, g, b } = ColorMapper.toRGB(activation);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  /**
   * Map activation to Three.js-compatible hex integer (0xRRGGBB).
   */
  static toInt(activation: number): number {
    const { r, g, b } = ColorMapper.toRGB(activation);
    return (r << 16) | (g << 8) | b;
  }

  /**
   * Map activation to RGB (0–255 each).
   */
  static toRGB(activation: number): RGB {
    const clamped = Math.max(0, Math.min(1, activation));

    let lower = GRADIENT[0]!;
    let upper = GRADIENT[GRADIENT.length - 1]!;

    for (let i = 0; i < GRADIENT.length - 1; i++) {
      if (clamped >= GRADIENT[i]!.pos && clamped <= GRADIENT[i + 1]!.pos) {
        lower = GRADIENT[i]!;
        upper = GRADIENT[i + 1]!;
        break;
      }
    }

    const t = (clamped - lower.pos) / (upper.pos - lower.pos || 1);
    const h = lower.h + t * (upper.h - lower.h);
    const s = lower.s + t * (upper.s - lower.s);
    const l = lower.l + t * (upper.l - lower.l);

    return hslToRgb(h, s / 100, l / 100);
  }

  /**
   * Get emissive intensity for a given activation (used in Three.js materials).
   */
  static emissiveIntensity(activation: number): number {
    return activation * 0.5; // 0–0.5 emissive multiplier
  }
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  if (h < 60)        { r = c; g = x; b = 0; }
  else if (h < 120)  { r = x; g = c; b = 0; }
  else if (h < 180)  { r = 0; g = c; b = x; }
  else if (h < 240)  { r = 0; g = x; b = c; }
  else if (h < 300)  { r = x; g = 0; b = c; }
  else               { r = c; g = 0; b = x; }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}
