import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import SceneKey, { type SceneStats } from '../SceneKey.js';

/**
 * F3 — the key printed "30-day half-life" as the definition of the brightness
 * channel while the server's decay policy was 7 days, so a month-old memory
 * drew at 0.71 (reading as "still fresh") against a server-side strength of
 * 2^(-30/7) = 0.051, sitting on the archive threshold. The legend inverted the
 * reading of every dim node in the graph.
 *
 * The key's honesty about provenance (what the positions mean, what is NOT on
 * screen) is what the reviews called correct, so this is the same voice applied
 * to the one channel that was still asserting a number nobody had checked.
 */

const { policyRef } = vi.hoisted(() => ({
  policyRef: { current: null as { halfLifeDays: number; archiveThreshold: number } | null },
}));

vi.mock('../../../lib/decayPolicy.js', () => ({
  useDecayPolicy: () => policyRef.current,
}));

function stats(overrides: Partial<SceneStats> = {}): SceneStats {
  return {
    nodes: 651,
    method: 'pca3',
    unprojected: 0,
    explainedVariance: [0.21, 0.09, 0.06],
    edgesShown: 3099,
    edgesRenderable: 3099,
    edgesStored: 3102,
    edgeFilter: null,
    ...overrides,
  };
}

describe('SceneKey brightness row (F3)', () => {
  beforeEach(() => {
    cleanup();
    policyRef.current = null;
  });

  it('states the half-life the SERVER reports, not a constant of its own', () => {
    policyRef.current = { halfLifeDays: 7, archiveThreshold: 0.05 };
    render(<SceneKey stats={stats()} compact={false} />);

    expect(screen.getByText(/7-day half-life/)).toBeInTheDocument();
    expect(screen.queryByText(/30-day half-life/)).not.toBeInTheDocument();
  });

  it('follows the server if the policy changes, rather than pinning a number', () => {
    policyRef.current = { halfLifeDays: 14, archiveThreshold: 0.05 };
    render(<SceneKey stats={stats()} compact={false} />);

    expect(screen.getByText(/14-day half-life/)).toBeInTheDocument();
  });

  it('says the channel is off when the policy is unreachable, and names no number at all', () => {
    policyRef.current = null;
    render(<SceneKey stats={stats()} compact={false} />);

    expect(screen.getByText(/Decay policy unreachable/)).toBeInTheDocument();
    expect(screen.getByText(/brightness is off/)).toBeInTheDocument();
    expect(screen.queryByText(/half-life/)).not.toBeInTheDocument();
  });

  it('still states what it always stated about provenance and about what is not shown', () => {
    policyRef.current = { halfLifeDays: 7, archiveThreshold: 0.05 };
    render(<SceneKey stats={stats()} compact={false} />);

    expect(screen.getByText(/PCA of each memory/)).toBeInTheDocument();
    expect(screen.getByText(/3 more connections join memories that have been archived/)).toBeInTheDocument();
  });

  it('keeps saying positions mean nothing when the layout endpoint is offline', () => {
    policyRef.current = { halfLifeDays: 7, archiveThreshold: 0.05 };
    render(<SceneKey stats={stats({ method: 'offline' })} compact={false} />);

    expect(screen.getByText(/Positions unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Distance means nothing here/)).toBeInTheDocument();
  });
});
