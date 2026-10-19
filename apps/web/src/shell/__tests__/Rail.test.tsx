import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import Rail from '../Rail.js';
import BottomNav from '../BottomNav.js';
import { parseHash, useRouteStore } from '../routeStore.js';
import { compactCount } from '../icons.js';
import { useNeuralStore } from '../../store/neuralStore.js';

function at(hash: string) {
  act(() => useRouteStore.setState({ route: parseHash(hash) }));
}

describe('Rail', () => {
  beforeEach(() => {
    at('#/');
    useNeuralStore.setState({ isConnected: true });
  });

  it('links the six destinations by their words, in order', () => {
    render(<Rail reviewCount={0} />);
    const nav = screen.getByRole('navigation', { name: 'Engram' });
    const links = within(nav).getAllByRole('link').slice(1);
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Map', '#/'],
      ['Recall', '#/recall'],
      ['Timeline', '#/timeline'],
      ['Insights', '#/insights'],
      ['Review', '#/review'],
      ['Settings', '#/settings'],
    ]);
  });

  it('marks the current destination, and keeps Map current on the plates and Settings on the onboarding', () => {
    render(<Rail reviewCount={0} />);
    expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page');

    at('#/insights/reflections');
    expect(screen.getByRole('link', { name: 'Insights' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Map' })).not.toHaveAttribute('aria-current');

    at('#/plates');
    expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page');
    at('#/welcome');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  });

  it('counts what waits in Review, short on the badge and in full for a screen reader', () => {
    render(<Rail reviewCount={1498} />);
    const review = screen.getByRole('link', { name: /^Review/ });
    expect(review).toHaveTextContent('1.5k');
    expect(review).toHaveAccessibleName(/1,498 waiting/);
  });

  it('shows no badge at zero', () => {
    render(<Rail reviewCount={0} />);
    expect(screen.getByRole('link', { name: 'Review' })).toBeInTheDocument();
  });

  it('says whether live updates are connected', () => {
    render(<Rail reviewCount={0} />);
    expect(screen.getByRole('status')).toHaveTextContent('Live');
    act(() => useNeuralStore.setState({ isConnected: false }));
    expect(screen.getByRole('status')).toHaveTextContent('Offline');
  });
});

describe('compactCount', () => {
  it('fits a count in a badge', () => {
    expect(compactCount(7)).toBe('7');
    expect(compactCount(999)).toBe('999');
    expect(compactCount(1000)).toBe('1k');
    expect(compactCount(1498)).toBe('1.5k');
    expect(compactCount(23456)).toBe('23k');
  });
});

describe('BottomNav', () => {
  beforeEach(() => at('#/'));

  it('has four destinations and More, with the current one marked', () => {
    render(<BottomNav reviewCount={3} onCommands={() => {}} />);
    const nav = screen.getByRole('navigation', { name: 'Engram' });
    expect(within(nav).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['#/', '#/recall', '#/timeline', '#/review']);
    expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^Review\W+3 waiting$/ })).toBeInTheDocument();
  });

  it('holds Insights, Settings and the commands under More, and marks More while one is open', () => {
    const onCommands = vi.fn();
    render(<BottomNav reviewCount={0} onCommands={onCommands} />);
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Insights' })).toHaveAttribute('href', '#/insights');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#/settings');

    fireEvent.click(screen.getByRole('button', { name: 'Commands' }));
    expect(onCommands).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link', { name: 'Insights' })).not.toBeInTheDocument();

    at('#/settings');
    expect(more).toHaveAttribute('aria-current', 'page');
  });

  it('closes More on Escape, handing focus back, and on a tap elsewhere', () => {
    render(<BottomNav reviewCount={0} onCommands={() => {}} />);
    const more = screen.getByRole('button', { name: 'More' });
    fireEvent.click(more);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('link', { name: 'Insights' })).not.toBeInTheDocument();
    expect(more).toHaveFocus();

    fireEvent.click(more);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('link', { name: 'Insights' })).not.toBeInTheDocument();
  });
});
