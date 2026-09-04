import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ViewSwitcher from '../ViewSwitcher.js';
import { useViewStore, VIEWS } from '../../../store/viewStore.js';
import { useDashboardStore } from '../../../store/dashboardStore.js';

describe('ViewSwitcher', () => {
  beforeEach(() => {
    useViewStore.setState({ activeViewId: 'cosmos', activeView: VIEWS[0]! });
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
});
