/**
 * The switcher renders whatever VIEWS holds rather than naming views itself,
 * so the things worth pinning are that removing Nebula and Galaxy really did
 * remove them from the UI, and that the active view is announced rather than
 * only tinted.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ViewSwitcher from '../ViewSwitcher.js';
import { useViewStore, VIEWS } from '../../../store/viewStore.js';
import { useDashboardStore } from '../../../store/dashboardStore.js';

describe('ViewSwitcher', () => {
  beforeEach(() => {
    useViewStore.getState().setView('cosmos');
    useDashboardStore.setState({ viewMode: '3d' });
  });

  it('switches dashboard viewMode on a mode-tab click', () => {
    render(<ViewSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: /timeline/i }));
    expect(useDashboardStore.getState().viewMode).toBe('timeline');
  });

  it('shows 3D sub-views only in 3D mode', () => {
    const { rerender } = render(<ViewSwitcher />);
    expect(screen.getByTitle(VIEWS[1]!.description)).toBeInTheDocument();

    useDashboardStore.setState({ viewMode: 'timeline' });
    rerender(<ViewSwitcher />);
    expect(screen.queryByTitle(VIEWS[1]!.description)).not.toBeInTheDocument();
  });

  it('switches the active 3D sub-view on click', () => {
    render(<ViewSwitcher />);
    fireEvent.click(screen.getByTitle(VIEWS[1]!.description));
    expect(useViewStore.getState().activeViewId).toBe(VIEWS[1]!.id);
  });

  it('offers exactly the surviving views', () => {
    render(<ViewSwitcher />);
    for (const view of VIEWS) {
      expect(screen.getByText(view.name)).toBeInTheDocument();
    }
    expect(screen.queryByText(/nebula/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/galaxy/i)).not.toBeInTheDocument();
  });

  it('marks the active view with aria-pressed, not just a background tint', () => {
    render(<ViewSwitcher />);
    const clusters = screen.getByText('Clusters').closest('button')!;
    expect(clusters).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(clusters);
    expect(useViewStore.getState().activeViewId).toBe('clusters');
    expect(clusters).toHaveAttribute('aria-pressed', 'true');
  });
});
