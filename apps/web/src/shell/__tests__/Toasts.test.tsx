import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Toasts, { showToast, useToasts, TOAST_MS, TOAST_ACTION_MS } from '../Toasts.js';

describe('Toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToasts.setState({ toast: null, visible: false });
  });
  afterEach(() => vi.useRealTimers());

  it('says what happened in a polite live region, then goes', () => {
    render(<Toasts />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('data-on', 'false');

    act(() => showToast('Memory stored'));
    expect(region).toHaveAttribute('data-on', 'true');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Memory stored');

    act(() => vi.advanceTimersByTime(TOAST_MS));
    expect(region).toHaveAttribute('data-on', 'false');
  });

  it('stays longer when it can be undone, and runs the action once', () => {
    const undo = vi.fn();
    render(<Toasts />);
    act(() => showToast('Archived', { label: 'Undo', run: undo }));

    act(() => vi.advanceTimersByTime(TOAST_MS));
    expect(screen.getByRole('status')).toHaveAttribute('data-on', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveAttribute('data-on', 'false');
    expect(TOAST_ACTION_MS).toBeGreaterThan(TOAST_MS);
  });

  it('replaces the toast on screen with a newer one, and restarts its clock', () => {
    render(<Toasts />);
    act(() => showToast('First'));
    act(() => vi.advanceTimersByTime(TOAST_MS - 100));
    act(() => showToast('Second'));
    act(() => vi.advanceTimersByTime(200));

    expect(screen.getByRole('status')).toHaveTextContent('Second');
    expect(screen.getByRole('status')).toHaveAttribute('data-on', 'true');
  });
});
