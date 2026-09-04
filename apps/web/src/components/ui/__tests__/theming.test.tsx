import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import StatusBar from '../StatusBar.js';
import StoreMemoryModal from '../StoreMemoryModal.js';
import UnlockGate from '../UnlockGate.js';
import { useTemplateStore, TEMPLATES } from '../../../store/templateStore.js';
import { useAuthStore } from '../../../store/authStore.js';

const [neural, mono, midnight] = TEMPLATES;

// V5: "the theme switcher doesn't theme everything" — StoreMemoryModal.tsx
// and StatusBar.tsx never imported useTemplateStore at all, so every colour
// in them was a Neural-only hex literal; UnlockGate needed the same check.
// These assert the *rendered* style actually tracks the active template,
// not just that the import exists.
describe('theming (V5) — StatusBar / StoreMemoryModal / UnlockGate read the active template', () => {
  afterEach(() => {
    cleanup();
    useTemplateStore.setState({ activeTemplate: neural! });
  });

  it('StatusBar brand mark colour changes with the template (was a hardcoded #1e3050)', () => {
    useTemplateStore.setState({ activeTemplate: neural! });
    const { unmount } = render(<StatusBar />);
    const neuralColor = screen.getByText('Engram').style.color;
    unmount();

    useTemplateStore.setState({ activeTemplate: midnight! });
    render(<StatusBar />);
    const midnightColor = screen.getByText('Engram').style.color;

    expect(neuralColor).not.toBe('');
    expect(midnightColor).not.toBe('');
    expect(midnightColor).not.toBe(neuralColor);
  });

  it('StoreMemoryModal Save button fill changes with the template (was a hardcoded #6366f1/#4f46e5 gradient)', () => {
    useTemplateStore.setState({ activeTemplate: neural! });
    const { unmount } = render(<StoreMemoryModal onClose={() => {}} onStored={() => {}} />);
    const neuralBg = screen.getByRole('button', { name: /store memory/i }).style.background;
    unmount();

    useTemplateStore.setState({ activeTemplate: mono! });
    render(<StoreMemoryModal onClose={() => {}} onStored={() => {}} />);
    const monoBg = screen.getByRole('button', { name: /store memory/i }).style.background;

    expect(neuralBg).toContain('#6366f1');
    expect(monoBg).not.toContain('#6366f1');
    expect(monoBg).toContain('#ffffff'); // Mono's accent is white
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

    expect(neuralBg).toContain('#6366f1');
    expect(midnightBg).toContain('#a855f7');
    expect(midnightBg).not.toBe(neuralBg);
  });
});
