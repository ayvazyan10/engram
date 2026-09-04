import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useServerStats, resetServerStats } from '../serverStats.js';
import { api } from '../api.js';

vi.mock('../api.js', () => ({ api: { stats: vi.fn() } }));

const census = { total: 653, byType: { episodic: 33, semantic: 513, procedural: 107 }, bySource: { 'claude-code': 143 } };

describe('useServerStats (H6 — the real total, shared)', () => {
  beforeEach(() => {
    resetServerStats();
    vi.mocked(api.stats).mockReset();
  });

  afterEach(() => {
    resetServerStats();
  });

  it('starts null and resolves to the server census', async () => {
    vi.mocked(api.stats).mockResolvedValue(census);
    const { result } = renderHook(() => useServerStats());

    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current?.total).toBe(653));
  });

  it('asks once for two subscribers — the sidebar and the status bar cannot disagree', async () => {
    vi.mocked(api.stats).mockResolvedValue(census);
    const a = renderHook(() => useServerStats());
    const b = renderHook(() => useServerStats());

    await waitFor(() => expect(a.result.current?.total).toBe(653));
    expect(b.result.current).toEqual(a.result.current);
    expect(api.stats).toHaveBeenCalledTimes(1);
  });

  it('keeps the last good census when a poll fails rather than blanking the count', async () => {
    vi.mocked(api.stats).mockResolvedValue(census);
    const { result } = renderHook(() => useServerStats());
    await waitFor(() => expect(result.current?.total).toBe(653));

    vi.mocked(api.stats).mockRejectedValueOnce(new Error('network down'));
    const second = renderHook(() => useServerStats());
    expect(second.result.current?.total).toBe(653);
  });

  it('falls back to summing byType when the server omits a total', async () => {
    vi.mocked(api.stats).mockResolvedValue({ byType: { semantic: 2, episodic: 3 } } as unknown as typeof census);
    const { result } = renderHook(() => useServerStats());
    await waitFor(() => expect(result.current?.total).toBe(5));
  });
});
