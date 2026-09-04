import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDecayPolicy, resetDecayPolicy } from '../decayPolicy.js';
import { api } from '../api.js';

vi.mock('../api.js', () => ({ api: { getDecayPolicy: vi.fn() } }));

/** What GET /api/decay/policy actually returns on the live server. */
const policy = {
  halfLifeDays: 7,
  archiveThreshold: 0.05,
  decayIntervalMs: 3600000,
  batchSize: 200,
};

describe('useDecayPolicy (F3 — the half-life is the server\'s, not the client\'s)', () => {
  beforeEach(() => {
    resetDecayPolicy();
    vi.mocked(api.getDecayPolicy).mockReset();
  });

  afterEach(() => {
    resetDecayPolicy();
  });

  it('starts null and resolves to the server policy', async () => {
    vi.mocked(api.getDecayPolicy).mockResolvedValue(policy);
    const { result } = renderHook(() => useDecayPolicy());

    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current?.halfLifeDays).toBe(7));
    expect(result.current?.archiveThreshold).toBe(0.05);
  });

  it('asks once for two subscribers — the scene and its key cannot disagree about the channel', async () => {
    vi.mocked(api.getDecayPolicy).mockResolvedValue(policy);
    const a = renderHook(() => useDecayPolicy());
    const b = renderHook(() => useDecayPolicy());

    await waitFor(() => expect(a.result.current?.halfLifeDays).toBe(7));
    expect(b.result.current).toEqual(a.result.current);
    expect(api.getDecayPolicy).toHaveBeenCalledTimes(1);
  });

  it('stays null on a failed fetch rather than substituting a half-life of its own', async () => {
    vi.mocked(api.getDecayPolicy).mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useDecayPolicy());

    await waitFor(() => expect(api.getDecayPolicy).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('rejects a response that is not a usable policy — an unusable one must not become one', async () => {
    for (const bad of [null, {}, { halfLifeDays: 0 }, { halfLifeDays: -3 }, { halfLifeDays: 'seven' }]) {
      resetDecayPolicy();
      vi.mocked(api.getDecayPolicy).mockResolvedValue(bad as unknown as typeof policy);
      const { result } = renderHook(() => useDecayPolicy());
      await waitFor(() => expect(api.getDecayPolicy).toHaveBeenCalled());
      expect(result.current, JSON.stringify(bad)).toBeNull();
    }
  });

  it('defaults a missing archiveThreshold rather than dropping an otherwise valid policy', async () => {
    vi.mocked(api.getDecayPolicy).mockResolvedValue({ halfLifeDays: 7 } as unknown as typeof policy);
    const { result } = renderHook(() => useDecayPolicy());
    await waitFor(() => expect(result.current?.halfLifeDays).toBe(7));
    expect(result.current?.archiveThreshold).toBe(0);
  });

  it('stops asking once it has an answer — a policy is configuration, not a moving figure', async () => {
    vi.mocked(api.getDecayPolicy).mockResolvedValue(policy);
    const { result, unmount } = renderHook(() => useDecayPolicy());
    await waitFor(() => expect(result.current?.halfLifeDays).toBe(7));
    unmount();

    renderHook(() => useDecayPolicy());
    expect(api.getDecayPolicy).toHaveBeenCalledTimes(1);
  });
});
