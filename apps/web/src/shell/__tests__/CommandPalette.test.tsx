import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import CommandPalette, { matchCommand } from '../CommandPalette.js';
import { parseHash, useRouteStore } from '../routeStore.js';
import { useTheme } from '../theme.js';
import { useToasts } from '../Toasts.js';
import { useMemoryStore } from '../../store/memoryStore.js';
import { refreshServerStats, resetServerStats } from '../../lib/serverStats.js';
import { api } from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  api: { stats: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

/** The palette as the shell hosts it: a trigger outside, open state held above. */
function Host({ onSearch = () => {}, onStore = () => {} }: { onSearch?: () => void; onStore?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <CommandPalette open={open} onClose={() => setOpen(false)} onSearch={onSearch} onStore={onStore} />
    </>
  );
}

function open() {
  const trigger = screen.getByRole('button', { name: 'Open' });
  trigger.focus();
  fireEvent.click(trigger);
  return screen.getByRole('combobox');
}

describe('CommandPalette', () => {
  beforeEach(() => {
    resetServerStats();
    window.location.hash = '';
    useRouteStore.setState({ route: parseHash('') });
    useMemoryStore.setState({ projectFilter: undefined });
    useTheme.setState({ mode: 'auto' });
    useToasts.setState({ toast: null, visible: false });
    vi.mocked(api.stats).mockResolvedValue({ total: 0, byType: {}, bySource: {} } as never);
  });

  it('opens as a labelled modal with the field focused', () => {
    render(<Host />);
    const input = open();
    expect(screen.getByRole('dialog', { name: 'Commands' })).toHaveAttribute('aria-modal', 'true');
    expect(input).toHaveFocus();
  });

  it('filters as you type, and says when nothing matches', () => {
    render(<Host />);
    const input = open();
    fireEvent.change(input, { target: { value: 'timeline' } });
    expect(screen.getByRole('option', { name: /Timeline/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Settings/ })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'zzzzqqq' } });
    expect(screen.getByText('No command matches.')).toBeInTheDocument();
  });

  it('ranks the command that is named by the words first', () => {
    render(<Host />);
    const input = open();
    fireEvent.change(input, { target: { value: 'dark' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Dark mode']);
    fireEvent.change(input, { target: { value: 'set' } });
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Settings');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('goes where a destination says, closes, and hands focus back', () => {
    render(<Host />);
    open();
    fireEvent.click(screen.getByRole('option', { name: /Insights: reflections/ }));
    expect(useRouteStore.getState().route).toEqual({ name: 'insights', sub: 'reflections', params: {} });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('runs a command from the keyboard: arrows move, Enter runs', () => {
    const onStore = vi.fn();
    render(<Host onStore={onStore} />);
    const input = open();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /Store a memory/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onStore).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('hands search to the shell', () => {
    const onSearch = vi.fn();
    render(<Host onSearch={onSearch} />);
    open();
    fireEvent.click(screen.getByRole('option', { name: /Search your memories/ }));
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape (marked handled) and on a click on the scrim, not inside', () => {
    render(<Host />);
    const input = open();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      input.dispatchEvent(escape);
    });
    expect(escape.defaultPrevented).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    open();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps Tab inside: the field is the one stop', () => {
    render(<Host />);
    const input = open();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => {
      input.dispatchEvent(tab);
    });
    expect(tab.defaultPrevented).toBe(true);
  });

  it('switches the colour mode, marks the current one, and says so', () => {
    render(<Host />);
    open();
    expect(screen.getByRole('option', { name: /Match system colours/ })).toHaveTextContent('Current');
    fireEvent.click(screen.getByRole('option', { name: /Dark mode/ }));
    expect(useTheme.getState().mode).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(useToasts.getState().toast?.message).toBe('Dark mode on');
    act(() => useTheme.getState().setMode('auto'));
  });

  it('lists the projects once there is more than one, and picks the scope', async () => {
    vi.mocked(api.stats).mockResolvedValue({
      total: 5,
      byType: {},
      bySource: {},
      byNamespace: [{ namespace: null, count: 2 }, { namespace: '/code/api', count: 3 }],
    } as never);
    await act(async () => {
      await refreshServerStats();
    });
    render(<Host />);
    open();
    expect(screen.getByRole('option', { name: /Show all projects/ })).toHaveTextContent('Current');
    fireEvent.click(screen.getByRole('option', { name: /Show api/ }));
    expect(useMemoryStore.getState().projectFilter).toBe('/code/api');
  });
});

describe('matchCommand', () => {
  it('needs every word, and ranks a name prefix over a name match over a keyword match', () => {
    expect(matchCommand('Dark mode', '')).toBe(1);
    expect(matchCommand('Dark mode', 'dark')).toBe(1);
    expect(matchCommand('Match system colours', 'colours')).toBe(0.8);
    expect(matchCommand('Light mode', 'theme', ['theme'])).toBe(0.5);
    expect(matchCommand('Store a memory', 'dark', ['remember', 'add'])).toBe(0);
    expect(matchCommand('Insights: reflections', 'insights refl')).toBe(1);
    expect(matchCommand('Insights: reflections', 'insights numbers')).toBe(0);
  });
});
