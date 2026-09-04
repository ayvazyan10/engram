import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { DataDot, TypeTag } from '../DataMark.js';
import { TYPE_COLORS, contrastRatio, withAlpha } from '../../../lib/tokens.js';
import { TEMPLATES } from '../../../store/templateStore.js';

/**
 * F2 — "Text never wears the data color… Identity comes from the colored mark
 * beside the text — a dot, a short line-key, a swatch — never from coloring the
 * text itself."
 *
 * Four surfaces broke that: the timeline's type badge, the status bar's E/S/P
 * letters, every 3D label, and the sidebar's 11px type glyph. This file holds
 * the shared mark those all moved onto, plus the source guard that keeps the
 * rule from being re-broken one component at a time.
 */

/** `hex` at `alpha` over `bg`, the way the browser composites the tag's tint. */
function composite(hex: string, alpha: number, bg: string): string {
  const parse = (v: string) => {
    const clean = v.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  };
  const fg = parse(hex);
  const back = parse(bg);
  return `#${[0, 1, 2]
    .map((i) => Math.round(fg[i]! * alpha + back[i]! * (1 - alpha)).toString(16).padStart(2, '0'))
    .join('')}`;
}

const rgb = (hex: string) => {
  const clean = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

describe('DataDot', () => {
  it('is a round swatch in the data colour, hidden from assistive tech', () => {
    render(<DataDot color={TYPE_COLORS.semantic} />);
    const dot = document.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(dot.style.background).toBe(rgb(TYPE_COLORS.semantic));
    expect(dot.style.borderRadius).toBe('50%');
    expect(dot.style.width).toBe('8px');
  });
});

describe('TypeTag', () => {
  it('names the type in ink and carries the hue on the dot beside it', () => {
    render(<TypeTag type="procedural" />);
    const tag = screen.getByText('Procedural');
    expect(tag.style.color).toBe(rgb(TEMPLATES[0]!.textPrimary));
    expect(tag.style.color).not.toBe(rgb(TYPE_COLORS.procedural));

    const dot = tag.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(dot.style.background).toBe(rgb(TYPE_COLORS.procedural));
  });

  it('reproduces why it had to move: the label was 5.08:1 on its own tint before, and 4.03:1 after the re-step', () => {
    const card = TEMPLATES[0]!.cardBg;
    expect(contrastRatio('#818cf8', composite('#818cf8', 0.125, card))).toBeCloseTo(5.08, 1);
    expect(contrastRatio(TYPE_COLORS.episodic, composite(TYPE_COLORS.episodic, 0.125, card))).toBeCloseTo(4.03, 1);
  });

  it('keeps the ink legible on the tint it sits on, in every template and for every type', () => {
    for (const template of TEMPLATES) {
      for (const [name, hex] of Object.entries(TYPE_COLORS)) {
        const mixed = composite(hex, 0.125, template.cardBg);
        expect(contrastRatio(template.textPrimary, mixed), `${name} tag on ${template.id}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // The tint itself is built with withAlpha, never by hex concatenation.
    expect(withAlpha(TYPE_COLORS.episodic, 0.125)).toMatch(/^rgba\(/);
  });
});

/**
 * The regression guard. The four sites were each hand-rolled, so fixing them
 * once does not stop a fifth appearing — this fails the build the moment any
 * component assigns a memory-type colour to a CSS `color`.
 *
 * `borderColor`, `background`, `stroke` and `fill` are marks and are allowed;
 * only `color:` (the text/glyph channel) is guarded.
 */
const COMPONENTS_DIR = join(__dirname, '../..');
const TEXT_COLOR_FROM_DATA = /\bcolor:\s*[^,;}\n]*TYPE_COLORS/;

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('no component paints text in a memory-type colour (F2)', () => {
  it('finds no `color:` expression anywhere that reads from the type palette', () => {
    const offenders: string[] = [];
    for (const file of sources(COMPONENTS_DIR)) {
      const content = readFileSync(file, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const [i, line] of content.split('\n').entries()) {
        if (TEXT_COLOR_FROM_DATA.test(line)) {
          offenders.push(`${relative(COMPONENTS_DIR, file).split(sep).join('/')}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the 3D labels are ink — every ambient label used to be its node\'s type colour', () => {
    const labels = readFileSync(join(COMPONENTS_DIR, 'canvas/NeuronLabels.tsx'), 'utf-8');
    expect(labels).toContain('LABEL_INK');
    expect(labels).not.toContain('TYPE_COLORS');
  });
});
