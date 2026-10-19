import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ScopeSwitch from '../ScopeSwitch.js';
import { useMemoryStore } from '../../store/memoryStore.js';
import { refreshServerStats, resetServerStats } from '../../lib/serverStats.js';
import { api } from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  api: { stats: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const API = '/home/me/code/api';
const WEB = '/home/me/code/web';

async function withProjects(byNamespace: { namespace: string | null; count: number }[]) {
  vi.mocked(api.stats).mockResolvedValue({
    total: byNamespace.reduce((n, b) => n + b.count, 0),
    byType: {},
    bySource: {},
    byNamespace,
  } as never);
  await act(async () => {
    await refreshServerStats();
  });
}

describe('ScopeSwitch', () => {
  beforeEach(async () => {
    resetServerStats();
    useMemoryStore.setState({ projectFilter: undefined });
    await withProjects([
      { namespace: null, count: 3 },
      { namespace: WEB, count: 4 },
      { namespace: API, count: 9 },
    ]);
  });

  it('offers All, Global, then each project by count, with its path', () => {
    render(<ScopeSwitch />);
    fireEvent.click(screen.getByRole('button', { name: 'Project: All projects' }));

    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'All projects16',
      'GlobalShared by every project3',
      `api${API}9`,
      `web${WEB}4`,
    ]);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    // Opening lands on the current choice.
    expect(options[0]).toHaveFocus();
  });

  it('sets the global scope on a pick and says so on the button', () => {
    render(<ScopeSwitch />);
    fireEvent.click(screen.getByRole('button', { name: 'Project: All projects' }));
    fireEvent.click(screen.getByRole('option', { name: /^api/ }));

    expect(useMemoryStore.getState().projectFilter).toBe(API);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Project: api' })).toHaveFocus();
  });

  it('is keyboard-complete: arrows open and move, Home/End jump, Enter picks, Escape closes', () => {
    render(<ScopeSwitch />);
    const button = screen.getByRole('button', { name: 'Project: All projects' });
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    const list = screen.getByRole('listbox');
    const options = screen.getAllByRole('option');

    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(options[1]).toHaveFocus();
    fireEvent.keyDown(list, { key: 'End' });
    expect(options[3]).toHaveFocus();
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(options[0]).toHaveFocus();
    fireEvent.keyDown(list, { key: 'Home' });
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(options[3]).toHaveFocus();

    fireEvent.keyDown(list, { key: 'Enter' });
    expect(useMemoryStore.getState().projectFilter).toBe(WEB);

    fireEvent.click(screen.getByRole('button', { name: 'Project: web' }));
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      screen.getByRole('listbox').dispatchEvent(escape);
    });
    // Marked handled, so the shell's Escape leaves the selected memory alone.
    expect(escape.defaultPrevented).toBe(true);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(useMemoryStore.getState().projectFilter).toBe(WEB);
  });

  it('closes on a pointer outside it without changing the scope', () => {
    render(<ScopeSwitch />);
    fireEvent.click(screen.getByRole('button', { name: 'Project: All projects' }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(useMemoryStore.getState().projectFilter).toBeUndefined();
  });

  it('is hidden while the store has one bucket, since there is nothing to choose', async () => {
    await withProjects([{ namespace: null, count: 5 }]);
    const { container } = render(<ScopeSwitch />);
    expect(container).toBeEmptyDOMElement();
  });

  it('stays reachable while a scope is active, even if the buckets collapsed since', async () => {
    await withProjects([{ namespace: null, count: 5 }]);
    useMemoryStore.setState({ projectFilter: API });
    render(<ScopeSwitch />);
    expect(screen.getByRole('button', { name: 'Project: api' })).toBeInTheDocument();
  });

  it('states the scope as a fact, not a control, where a screen cannot honour it', () => {
    useMemoryStore.setState({ projectFilter: API });
    render(<ScopeSwitch fixedNote="Insights count every project." />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Insights count every project.')).toBeInTheDocument();
  });
});
