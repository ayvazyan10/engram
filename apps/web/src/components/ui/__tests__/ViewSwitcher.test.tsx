/**
 * The switcher renders whatever VIEWS holds rather than naming plates itself,
 * so the things worth pinning are that the mode tab no longer claims a
 * dimension it cannot keep, that the chooser offers exactly the five and reads
 * each one's claim rather than hiding it in a tooltip, and that the active
 * plate is announced rather than only filled in.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ViewSwitcher from '../ViewSwitcher.js';
import { useViewStore, VIEWS, DEFAULT_VIEW_ID } from '../../../store/viewStore.js';
import { useDashboardStore } from '../../../store/dashboardStore.js';

function openChooser() {
  fireEvent.click(screen.getByRole('button', { name: /^Plate: / }));
  return screen.getByRole('group', { name: /choose a plate/i });
}

describe('ViewSwitcher mode tabs', () => {
  beforeEach(() => {
    useViewStore.getState().setView(DEFAULT_VIEW_ID);
    useDashboardStore.setState({ viewMode: '3d' });
  });

  it('switches dashboard viewMode on a mode-tab click', () => {
    render(<ViewSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: /timeline/i }));
    expect(useDashboardStore.getState().viewMode).toBe('timeline');
  });

  /**
   * The regression this replaces: the tab said "3D" while the surface behind
   * it was one WebGL scene. It is five plates now, only two of which are 3D,
   * so a tab labelled "3D" would be false about three of them.
   */
  it('does not label the plate surface with a dimension', () => {
    render(<ViewSwitcher />);
    expect(screen.getByRole('button', { name: 'Plates' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '3D' })).not.toBeInTheDocument();
  });

  it('opens on Home, the first tab', () => {
    useDashboardStore.setState(useDashboardStore.getInitialState());
    render(<ViewSwitcher />);
    expect(useDashboardStore.getState().viewMode).toBe('home');
    const tabs = ['Home', 'Plates', 'Timeline', 'Analytics', 'Reflections'].map((name) =>
      screen.getByRole('button', { name })
    );
    expect(tabs[0]).toHaveAttribute('aria-pressed', 'true');
    for (let i = 1; i < tabs.length; i++) {
      expect(tabs[i - 1]!.compareDocumentPosition(tabs[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('offers the plate chooser only on the plate surface', () => {
    const { rerender } = render(<ViewSwitcher />);
    expect(screen.getByRole('button', { name: /^Plate: / })).toBeInTheDocument();

    useDashboardStore.setState({ viewMode: 'analytics' });
    rerender(<ViewSwitcher />);
    expect(screen.queryByRole('button', { name: /^Plate: / })).not.toBeInTheDocument();
  });
});

describe('the plate chooser', () => {
  beforeEach(() => {
    useViewStore.getState().setView(DEFAULT_VIEW_ID);
    useDashboardStore.setState({ viewMode: '3d' });
  });

  it('names the active plate and its dimension on the closed control', () => {
    render(<ViewSwitcher />);
    const active = VIEWS.find((v) => v.id === DEFAULT_VIEW_ID)!;
    const trigger = screen.getByRole('button', { name: `Plate: ${active.name}, ${active.dimension}` });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent(active.name);
  });

  it('opens to exactly the five plates, each with its own name and caption in full', () => {
    render(<ViewSwitcher />);
    const panel = openChooser();
    const options = within(panel).getAllByRole('button');
    expect(options).toHaveLength(VIEWS.length);

    for (const view of VIEWS) {
      expect(within(panel).getByText(view.name)).toBeInTheDocument();
      // The caption is rendered, not hidden in a title attribute — it is the
      // sentence a reader chooses on.
      expect(within(panel).getByText(view.caption)).toBeInTheDocument();
    }
    expect(within(panel).queryByText(/cosmos|neural net|clusters/i)).not.toBeInTheDocument();
  });

  it('marks the active plate with aria-pressed, not just a filled ground', () => {
    render(<ViewSwitcher />);
    const panel = openChooser();
    const active = within(panel).getByText(VIEWS[0]!.name).closest('button')!;
    const other = within(panel).getByText(VIEWS[2]!.name).closest('button')!;
    expect(active).toHaveAttribute('aria-pressed', 'true');
    expect(other).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches the active plate on a click and closes', () => {
    render(<ViewSwitcher />);
    const panel = openChooser();
    fireEvent.click(within(panel).getByText(VIEWS[2]!.name).closest('button')!);

    expect(useViewStore.getState().activeViewId).toBe(VIEWS[2]!.id);
    expect(screen.queryByRole('group', { name: /choose a plate/i })).not.toBeInTheDocument();
  });

  /**
   * AppLayout binds a window-level Escape that clears the memory selection.
   * Closing the drawer must mark the key handled so that listener stands down
   * — otherwise dismissing the chooser silently throws away the selection.
   */
  it('closes on Escape and marks the key handled', () => {
    render(<ViewSwitcher />);
    const panel = openChooser();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    fireEvent(panel, event);

    expect(screen.queryByRole('group', { name: /choose a plate/i })).not.toBeInTheDocument();
    expect(event.defaultPrevented).toBe(true);
  });
});
