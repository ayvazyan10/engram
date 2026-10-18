import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import HomeView from '../HomeView.js';
import { useMemoryStore, type MemoryRecord } from '../../../store/memoryStore.js';
import { useNeuralStore } from '../../../store/neuralStore.js';
import { resetServerStats } from '../../../lib/serverStats.js';

vi.mock('../../../lib/api.js', () => ({
  api: {
    stats: vi.fn().mockResolvedValue({ total: 2, byType: {}, bySource: {} }),
    getGraph: vi.fn().mockResolvedValue({ node: null, connections: [], neighbors: [] }),
    getContradictions: vi.fn().mockResolvedValue([]),
  },
}));

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'mem-1',
    type: 'semantic',
    content: 'The user prefers pnpm over npm for every workspace.',
    summary: null,
    importance: 0.5,
    source: 'claude-code',
    concept: null,
    tags: '["preference","tooling","pnpm","workspace"]',
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function renderHome() {
  return render(
    <HomeView loading={false} error={null} onRetry={() => {}} onLoadMore={() => {}} loadingMore={false} onStore={() => {}} />
  );
}

describe('HomeView', () => {
  beforeEach(() => {
    resetServerStats();
    useNeuralStore.setState({ selectedNeuronId: null });
    useMemoryStore.setState({
      records: [record(), record({ id: 'mem-2', type: 'episodic', content: 'Fixed the flaky deploy.', source: 'cursor', tags: '[]' })],
      searchResults: [],
      searchQuery: '',
      isSearching: false,
    });
  });

  it('puts search first, then the recent memories as cards', () => {
    renderHome();
    expect(screen.getByRole('heading', { name: 'Recent memories' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(2);
  });

  it('shows content, the type as a word, the source, a relative date and the tags on a card', () => {
    renderHome();
    const card = screen.getByText(/prefers pnpm over npm/).closest('button')!;
    const c = within(card);
    expect(c.getByText('Semantic')).toBeInTheDocument();
    expect(c.getByText('claude-code')).toBeInTheDocument();
    expect(c.getByText('3 hours ago')).toBeInTheDocument();
    expect(c.getByText('preference')).toBeInTheDocument();
    expect(c.getByText('tooling')).toBeInTheDocument();
    expect(c.getByText('pnpm')).toBeInTheDocument();
    // Three tags shown, the fourth counted.
    expect(c.queryByText('workspace')).not.toBeInTheDocument();
    expect(c.getByText('+1')).toBeInTheDocument();
  });

  it('opens the inspector for a clicked card, and closes it on a second click', () => {
    renderHome();
    expect(screen.queryByRole('complementary', { name: 'Memory details' })).not.toBeInTheDocument();

    const card = screen.getByText(/prefers pnpm over npm/).closest('button')!;
    fireEvent.click(card);
    expect(useNeuralStore.getState().selectedNeuronId).toBe('mem-1');
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('complementary', { name: 'Memory details' })).toBeInTheDocument();

    fireEvent.click(card);
    expect(useNeuralStore.getState().selectedNeuronId).toBeNull();
  });

  it('lists search results under their own heading', () => {
    useMemoryStore.setState({ searchQuery: 'deploy', searchResults: [record({ id: 'mem-2', content: 'Fixed the flaky deploy.' })] });
    renderHome();
    expect(screen.getByRole('heading', { name: 'Results' })).toBeInTheDocument();
    expect(screen.getByText('1 found')).toBeInTheDocument();
  });

  it('shows the first-run onboarding instead when the store is empty', () => {
    useMemoryStore.setState({ records: [] });
    renderHome();
    expect(screen.getByRole('heading', { name: 'Connect your AI in 30 seconds' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recent memories' })).not.toBeInTheDocument();
  });
});
