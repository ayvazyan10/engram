import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBar from '../StatusBar.js';
import { useMemoryStore } from '../../../store/memoryStore.js';
import { useNeuralStore } from '../../../store/neuralStore.js';

/** The census arrives asynchronously, so the bar has to render both with and
 *  without it — hoisted so the mock factory can read it. */
const { statsRef } = vi.hoisted(() => ({
  statsRef: {
    current: null as {
      total: number;
      byType: Record<string, number>;
      bySource: Record<string, number>;
    } | null,
  },
}));

vi.mock('../../../lib/serverStats.js', () => ({
  useServerStats: () => statsRef.current,
}));

/** jsdom doesn't implement matchMedia; this stands in for the viewport. */
function setViewportMatches(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    media: '',
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as typeof window.matchMedia;
}

describe('StatusBar overflow (H9 — the bar overprinted the mobile tab bar at 320px)', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    statsRef.current = {
      total: 653,
      byType: { episodic: 33, semantic: 513, procedural: 107 },
      bySource: {},
    };
    useMemoryStore.setState({ loadedCount: 200, recallLatencyMs: 42, currentContext: '' });
    useNeuralStore.setState({ neurons: [] });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('shows every segment on a wide viewport', () => {
    setViewportMatches(false);
    render(<StatusBar />);

    expect(screen.getByText('653 memories')).toBeInTheDocument();
    expect(screen.getByText('0 nodes visible')).toBeInTheDocument();
    expect(screen.getByTitle('Episodic memories')).toBeInTheDocument();
    expect(screen.getByText('42ms')).toBeInTheDocument();
    expect(screen.getByText('Engram')).toBeInTheDocument();
  });

  it('drops the type chips and "nodes visible" below 640px, keeping total, latency and brand', () => {
    setViewportMatches(true);
    render(<StatusBar />);

    expect(screen.queryByTitle('Episodic memories')).not.toBeInTheDocument();
    expect(screen.queryByText('0 nodes visible')).not.toBeInTheDocument();
    expect(screen.getByText('653 memories')).toBeInTheDocument();
    expect(screen.getByText('42ms')).toBeInTheDocument();
    expect(screen.getByText('Engram')).toBeInTheDocument();
  });

  it('lets the bar grow rather than clipping its own content, with nowrap as the backstop', () => {
    setViewportMatches(true);
    const { container } = render(<StatusBar />);
    const bar = container.firstElementChild as HTMLElement;

    expect(bar.style.height).toBe('');
    expect(bar.style.minHeight).toBe('26px');
    expect(bar.style.overflow).toBe('hidden');
    expect(bar.style.whiteSpace).toBe('nowrap');
  });

  it('sets tabular numerals on the live latency readout, which reflowed as digits changed (M13)', () => {
    setViewportMatches(false);
    render(<StatusBar />);
    expect(screen.getByText('42ms').className).toContain('ec-tabular');
  });
});

describe('StatusBar memory count (H6 — two quantities, never swapped for each other)', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    statsRef.current = {
      total: 653,
      byType: { episodic: 33, semantic: 513, procedural: 107 },
      bySource: {},
    };
    useMemoryStore.setState({ loadedCount: 200, recallLatencyMs: null, currentContext: '' });
    useNeuralStore.setState({ neurons: [] });
    setViewportMatches(false);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('reports the server census as the store total once it has one', () => {
    render(<StatusBar />);

    expect(screen.getByText('653 memories')).toBeInTheDocument();
    expect(screen.getByTitle('653 stored memories')).toBeInTheDocument();
  });

  it('says what it actually knows before the census lands, rather than relabelling the loaded page as the total', () => {
    statsRef.current = null;
    render(<StatusBar />);

    // 200 is the size of the loaded page — the server caps listMemories at
    // 200 — so on this 651-memory store the old `stats?.total ?? loadedCount`
    // fallback put "200 memories" on screen until the first poll returned.
    expect(screen.queryByText('200 memories')).not.toBeInTheDocument();
    expect(screen.getByText('200 loaded')).toBeInTheDocument();
    expect(screen.getByTitle(/total is not in yet/i)).toBeInTheDocument();
  });
});
