import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { COLOUR_MODE_KEY, initTheme, resolvedScheme, templateFromTokens, useTheme } from '../theme.js';
import { TEMPLATES, useTemplateStore } from '../../store/templateStore.js';

const ATLAS_LIGHT: Record<string, string> = {
  '--paper': '#EAF0EC',
  '--surface': '#F7FAF8',
  '--raised': '#FFFFFF',
  '--ink': '#0F2A26',
  '--ink-2': '#3F5A54',
  '--ink-3': '#56706A',
  '--rule': '#B7C9C0',
  '--on-ink': '#F7FAF8',
  '--focus': '#1F5ED9',
  '--wash': 'rgba(15, 42, 38, 0.06)',
  '--wash-2': 'rgba(15, 42, 38, 0.11)',
};

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

describe('template bridge (until F6)', () => {
  afterEach(() => {
    for (const name of Object.keys(ATLAS_LIGHT)) document.documentElement.style.removeProperty(name);
    useTemplateStore.setState({ activeTemplate: TEMPLATES[0]! });
  });

  it('is null where tokens.css is not applied, and leaves the template alone', () => {
    expect(templateFromTokens()).toBeNull();
    useTheme.getState().setMode('dark');
    expect(useTemplateStore.getState().activeTemplate.id).toBe(TEMPLATES[0]!.id);
    useTheme.getState().setMode('auto');
  });

  it('builds the old template from the Atlas tokens, as hex where the old views mix alpha', () => {
    for (const [name, value] of Object.entries(ATLAS_LIGHT)) document.documentElement.style.setProperty(name, value);
    const t = templateFromTokens()!;
    expect(t).toMatchObject({
      rootBg: '#EAF0EC',
      panelBg: '#F7FAF8',
      cardBg: '#FFFFFF',
      textPrimary: '#0F2A26',
      textMuted: '#56706A',
      panelBorder: '#B7C9C0',
      accent: '#0F2A26',
      onAccent: '#F7FAF8',
      focusRing: '#1F5ED9',
    });

    useTheme.getState().setMode('light');
    expect(useTemplateStore.getState().activeTemplate.id).toBe('atlas');
    useTheme.getState().setMode('auto');
  });
});
