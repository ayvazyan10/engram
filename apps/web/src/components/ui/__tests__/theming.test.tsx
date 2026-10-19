import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import StoreMemoryModal from '../StoreMemoryModal.js';
import UnlockGate from '../UnlockGate.js';
import { useAuthStore } from '../../../store/authStore.js';

// jsdom does not resolve custom properties. Check that rendered controls use
// the shared Atlas roles; the browser resolves those roles for each mode.
const css = readFileSync(join(__dirname, '../ui.css'), 'utf-8');
let sheet: HTMLStyleElement;

beforeEach(() => {
  sheet = document.createElement('style');
  sheet.textContent = css;
  document.head.append(sheet);
});

afterEach(() => {
  cleanup();
  sheet.remove();
});

describe('Atlas shared surfaces', () => {
  it('StoreMemoryModal uses Atlas surface, field and primary-action roles', () => {
    render(<StoreMemoryModal onClose={() => {}} onStored={() => {}} />);
    expect(getComputedStyle(screen.getByRole('dialog')).background).toBe('var(--surface)');
    const save = getComputedStyle(screen.getByRole('button', { name: /store memory/i }));
    expect(save.background).toBe('var(--ink)');
    expect(save.color).toBe('var(--on-ink)');
    expect(getComputedStyle(screen.getByRole('textbox', { name: /what do you want/i })).backgroundColor).toBe('var(--raised)');
  });

  it('StoreMemoryModal allows the global focus ring on every field', () => {
    render(<StoreMemoryModal onClose={() => {}} onStored={() => {}} />);
    for (const field of screen.getByRole('dialog').querySelectorAll('input, select, textarea')) {
      expect(getComputedStyle(field).outline).not.toBe('none');
    }
  });

  it('UnlockGate uses the same primary action and field roles', () => {
    useAuthStore.setState({ locked: true, hadKey: false });
    render(<UnlockGate />);
    const unlock = getComputedStyle(screen.getByRole('button', { name: /unlock/i }));
    expect(unlock.background).toBe('var(--ink)');
    expect(unlock.color).toBe('var(--on-ink)');
    expect(getComputedStyle(screen.getByLabelText('API key')).backgroundColor).toBe('var(--raised)');
  });
});
