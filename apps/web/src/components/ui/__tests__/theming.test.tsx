import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import StoreMemoryModal from '../StoreMemoryModal.js';
import UnlockGate from '../UnlockGate.js';
import { useTemplateStore, TEMPLATES } from '../../../store/templateStore.js';
import { useAuthStore } from '../../../store/authStore.js';

const [neural, mono, midnight] = TEMPLATES;

/** '#rrggbb' as the `rgb(r, g, b)` string jsdom reports back from a style. */
const rgb = (hex: string) => {
  const clean = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

// V5: "the theme switcher doesn't theme everything" — StoreMemoryModal.tsx
// and StatusBar.tsx never imported useTemplateStore at all, so every colour
// in them was a Neural-only hex literal; UnlockGate needed the same check.
// These assert the *rendered* style actually tracks the active template,
// not just that the import exists.
describe('theming (V5) — StoreMemoryModal / UnlockGate read the active template', () => {
  afterEach(() => {
    cleanup();
    useTemplateStore.setState({ activeTemplate: neural! });
  });

  // The fill is the template's solid `accentStrong` — the shade the store
  // defines precisely so the button's label clears 4.5:1 (Neural's plain
  // accent lands at ~4.47:1 under white text; Midnight's at ~3.96:1). It was
  // a diagonal accent-to-accentStrong gradient, which this test pinned by its
  // `accent` end; the invariant it was guarding — the fill tracks the
  // template, no hardcoded Neural hex — is asserted here against the flat
  // fill instead.
  it('StoreMemoryModal Save button fill changes with the template (was a hardcoded #6366f1/#4f46e5 gradient)', () => {
    useTemplateStore.setState({ activeTemplate: neural! });
    const { unmount } = render(<StoreMemoryModal onClose={() => {}} onStored={() => {}} />);
    const neuralBg = screen.getByRole('button', { name: /store memory/i }).style.background;
    unmount();

    useTemplateStore.setState({ activeTemplate: mono! });
    render(<StoreMemoryModal onClose={() => {}} onStored={() => {}} />);
    const monoBg = screen.getByRole('button', { name: /store memory/i }).style.background;

    expect(neuralBg).toBe(rgb(neural!.accentStrong));
    expect(monoBg).not.toBe(neuralBg);
    expect(monoBg).toBe(rgb(mono!.accentStrong)); // Mono's accent is white
  });

  it('StoreMemoryModal no longer sets outline:none on its text fields (V2)', () => {
    render(<StoreMemoryModal onClose={() => {}} onStored={() => {}} />);
    const textarea = screen.getByPlaceholderText(/what do you want to remember/i);
    expect(textarea.style.outline).not.toBe('none');
  });

  it('UnlockGate submit button fill changes with the template (was a hardcoded gradient)', () => {
    useAuthStore.setState({ locked: true, hadKey: false });

    useTemplateStore.setState({ activeTemplate: neural! });
    const { unmount } = render(<UnlockGate />);
    const neuralBg = screen.getByRole('button', { name: /unlock/i }).style.background;
    unmount();

    useTemplateStore.setState({ activeTemplate: midnight! });
    render(<UnlockGate />);
    const midnightBg = screen.getByRole('button', { name: /unlock/i }).style.background;

    expect(neuralBg).toBe(rgb(neural!.accentStrong));
    expect(midnightBg).toBe(rgb(midnight!.accentStrong));
    expect(midnightBg).not.toBe(neuralBg);
  });
});
