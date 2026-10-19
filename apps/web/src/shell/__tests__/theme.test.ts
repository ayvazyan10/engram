import { describe, it, expect, beforeEach } from 'vitest';
import { COLOUR_MODE_KEY, initTheme, resolvedScheme, useTheme } from '../theme.js';

describe('colour mode', () => {
  beforeEach(() => {
    localStorage.clear();
    useTheme.setState({ mode: 'auto' });
    delete document.documentElement.dataset.theme;
  });

  it('puts a Light or Dark choice on <html> and keeps it; Auto removes both', () => {
    useTheme.getState().setMode('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(COLOUR_MODE_KEY)).toBe('dark');

    useTheme.getState().setMode('light');
    expect(document.documentElement.dataset.theme).toBe('light');

    useTheme.getState().setMode('auto');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(COLOUR_MODE_KEY)).toBeNull();
  });

  it('still switches when storage is blocked', () => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    try {
      useTheme.getState().setMode('dark');
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(useTheme.getState().mode).toBe('dark');
    } finally {
      Storage.prototype.setItem = setItem;
    }
  });

  it('applies the stored mode at start', () => {
    useTheme.setState({ mode: 'light' });
    initTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('resolves Auto from the system, and a choice as itself', () => {
    expect(resolvedScheme('dark')).toBe('dark');
    expect(resolvedScheme('light')).toBe('light');
    expect(['light', 'dark']).toContain(resolvedScheme('auto'));
  });
});
