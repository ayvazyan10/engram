import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deferAction, flushDeferred, UNDO_MS } from '../deferredAction.js';
import { useToasts } from '../../../shell/Toasts.js';

function action() {
  return {
    message: 'Archived.',
    commit: vi.fn().mockResolvedValue(undefined),
    undo: vi.fn(),
    onError: vi.fn(),
  };
}

describe('deferAction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToasts.setState({ toast: null, visible: false, queued: null });
  });

  afterEach(() => {
    flushDeferred();
    vi.useRealTimers();
  });

  it('shows an Undo toast and sends the call only after the undo window', () => {
    const a = action();
    deferAction(a);
    expect(useToasts.getState().toast?.message).toBe('Archived.');
    expect(useToasts.getState().toast?.action?.label).toBe('Undo');
    vi.advanceTimersByTime(UNDO_MS - 1);
    expect(a.commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(a.commit).toHaveBeenCalledWith(false);
  });

  it('Undo cancels the call and puts things back', () => {
    const a = action();
    deferAction(a);
    useToasts.getState().toast?.action?.run();
    vi.advanceTimersByTime(UNDO_MS * 2);
    expect(a.undo).toHaveBeenCalledTimes(1);
    expect(a.commit).not.toHaveBeenCalled();
  });

  it('Undo after the call was sent does nothing', () => {
    const a = action();
    deferAction(a);
    const undo = useToasts.getState().toast?.action;
    vi.advanceTimersByTime(UNDO_MS);
    undo?.run();
    expect(a.undo).not.toHaveBeenCalled();
  });

  it('Undo takes back the newest waiting action first, then offers the one before it', () => {
    const a = action();
    const b = { ...action(), message: 'Removed.' };
    deferAction(a);
    deferAction(b);
    expect(useToasts.getState().toast?.message).toBe('Removed.');

    useToasts.getState().toast?.action?.run();
    expect(b.undo).toHaveBeenCalledTimes(1);
    expect(a.undo).not.toHaveBeenCalled();
    expect(useToasts.getState().toast?.message).toBe('Archived.');

    useToasts.getState().toast?.action?.run();
    expect(a.undo).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(UNDO_MS * 2);
    expect(a.commit).not.toHaveBeenCalled();
    expect(b.commit).not.toHaveBeenCalled();
  });

  it('takes the Undo toast down once nothing is left to undo', () => {
    deferAction(action());
    expect(useToasts.getState().visible).toBe(true);
    vi.advanceTimersByTime(UNDO_MS);
    expect(useToasts.getState().visible).toBe(false);
  });

  it('leaving the page sends every waiting call at once, with keepalive', () => {
    const a = action();
    const b = action();
    deferAction(a);
    deferAction(b);
    window.dispatchEvent(new Event('pagehide'));
    expect(a.commit).toHaveBeenCalledWith(true);
    expect(b.commit).toHaveBeenCalledWith(true);
    vi.advanceTimersByTime(UNDO_MS);
    expect(a.commit).toHaveBeenCalledTimes(1);
  });

  it('reports a failed call', async () => {
    const a = action();
    const err = new Error('offline');
    a.commit.mockRejectedValue(err);
    deferAction(a);
    vi.advanceTimersByTime(UNDO_MS);
    await vi.waitFor(() => expect(a.onError).toHaveBeenCalledWith(err));
  });
});
