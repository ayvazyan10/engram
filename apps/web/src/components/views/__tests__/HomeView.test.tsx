import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import HomeView from '../HomeView.js';
import { useMemoryStore, type MemoryRecord } from '../../../store/memoryStore.js';
import { useNeuralStore } from '../../../store/neuralStore.js';
import { resetServerStats } from '../../../lib/serverStats.js';
import { api } from '../../../lib/api.js';

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

function renderHome(onStore: () => void = () => {}) {
  return render(
    <HomeView loading={false} error={null} onRetry={() => {}} onLoadMore={() => {}} loadingMore={false} onStore={onStore} />
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
      projectFilter: undefined,
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

describe('HomeView: what does my AI know?', () => {
  const CONTEXT = [
    '[NEURAL MEMORY CONTEXT]',
    '',
    '[KNOWLEDGE]',
    '• [094a5819 · 2026-10-18] The deploy pipeline runs on GitHub Actions.',
    '• [deadbeef · 2026-10-17] A memory the client cannot place.',
    '',
    '[END MEMORY CONTEXT]',
  ].join('\n');
  const FULL_ID = '094a5819-c599-40e3-be56-4ab69755d647';
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    resetServerStats();
    useNeuralStore.setState({ selectedNeuronId: null });
    useMemoryStore.setState({
      records: [record()],
      searchResults: [],
      searchQuery: '',
      isSearching: false,
      currentContext: '',
      contextIds: [],
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
  });

  function openLens() {
    fireEvent.click(screen.getByRole('tab', { name: 'What my AI knows' }));
  }

  it('is a second lens on the same search box, and says what it shows in one sentence', () => {
    renderHome();
    expect(screen.getByRole('tab', { name: 'Memories' })).toHaveAttribute('aria-selected', 'true');
    openLens();

    expect(screen.getByRole('tab', { name: 'What my AI knows' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'What your AI would receive' })).toBeInTheDocument();
    expect(screen.getByText(/exact text your AI gets back/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('What might your AI be asked?')).toBeInTheDocument();
    expect(screen.getByText('Type what your AI might be asked, then press Enter.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recent memories' })).not.toBeInTheDocument();
  });

  it('renders the recall block verbatim and opens a memory from its [id · date] prefix', () => {
    useMemoryStore.setState({ searchQuery: 'deploy', currentContext: CONTEXT, contextIds: [FULL_ID] });
    renderHome();
    openLens();

    const block = document.querySelector('pre')!;
    expect(block.textContent).toBe(CONTEXT);
    // A prefix the client can resolve is a control; one it cannot stays text.
    expect(within(block).getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText('1 memory · ' + CONTEXT.length.toLocaleString() + ' characters')).toBeInTheDocument();

    fireEvent.click(within(block).getByRole('button', { name: '[094a5819 · 2026-10-18]' }));
    expect(useNeuralStore.getState().selectedNeuronId).toBe(FULL_ID);
  });

  it('copies exactly the block the AI would get', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    useMemoryStore.setState({ searchQuery: 'deploy', currentContext: CONTEXT, contextIds: [FULL_ID] });
    renderHome();
    openLens();

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(CONTEXT);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('says plainly when the AI would get nothing, and offers to store a memory', () => {
    const onStore = vi.fn();
    useMemoryStore.setState({ searchQuery: 'zebra knitting', currentContext: '', contextIds: [] });
    renderHome(onStore);
    openLens();

    expect(screen.getByText(/your AI would get no memories back/)).toHaveTextContent('zebra knitting');
    expect(document.querySelector('pre')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Store a memory' }));
    expect(onStore).toHaveBeenCalled();
  });
});

describe('HomeView: projects', () => {
  const API = '/home/me/code/api';
  const WEB = '/home/me/code/web';
  const MIXED = {
    total: 16,
    byType: {},
    bySource: {},
    byNamespace: [
      { namespace: null, count: 3 },
      { namespace: API, count: 5 },
      { namespace: WEB, count: 8 },
    ],
  };

  beforeEach(() => {
    resetServerStats();
    useNeuralStore.setState({ selectedNeuronId: null });
    useMemoryStore.setState({
      records: [record(), record({ id: 'mem-2', content: 'Fixed the flaky deploy.', namespace: API })],
      searchResults: [],
      searchQuery: '',
      isSearching: false,
      projectFilter: undefined,
    });
  });

  afterEach(() => {
    vi.mocked(api.stats).mockResolvedValue({ total: 2, byType: {}, bySource: {} });
  });

  it('names each card\'s project, with the full path on hover, and Global for the rest', async () => {
    vi.mocked(api.stats).mockResolvedValue(MIXED);
    renderHome();
    const projectCard = screen.getByText('Fixed the flaky deploy.').closest('button')!;
    expect(await within(projectCard).findByText('api')).toBeInTheDocument();
    expect(within(projectCard).getByTitle(API)).toBeInTheDocument();
    const globalCard = screen.getByText(/prefers pnpm over npm/).closest('button')!;
    expect(within(globalCard).getByText('Global')).toBeInTheDocument();
  });

  it('shows the project and its path in the inspector', async () => {
    vi.mocked(api.stats).mockResolvedValue(MIXED);
    renderHome();
    fireEvent.click(screen.getByText('Fixed the flaky deploy.').closest('button')!);
    const inspector = screen.getByRole('complementary', { name: 'Memory details' });
    expect(await within(inspector).findByText('Project')).toBeInTheDocument();
    expect(within(inspector).getByText(API)).toBeInTheDocument();
  });

  it('offers All, Global, then each project by count, and picking one sets the filter', async () => {
    vi.mocked(api.stats).mockResolvedValue(MIXED);
    renderHome();
    fireEvent.click(await screen.findByRole('button', { name: 'Project: All projects' }));
    const options = within(screen.getByRole('group', { name: 'Show memories from' })).getAllByRole('button');
    expect(options.map((o) => o.textContent)).toEqual([
      'All projects16',
      'Global3Shared by every project',
      `web8${WEB}`,
      `api5${API}`,
    ]);
    expect(options[0]).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(options[3]!);
    expect(useMemoryStore.getState().projectFilter).toBe(API);
    expect(screen.getByRole('button', { name: 'Project: api' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Project: api' }));
    fireEvent.click(screen.getByRole('button', { name: /^Global/ }));
    expect(useMemoryStore.getState().projectFilter).toBeNull();
  });

  it('counts a filtered list against its own project', async () => {
    vi.mocked(api.stats).mockResolvedValue(MIXED);
    useMemoryStore.setState({ projectFilter: API });
    renderHome();
    expect(await screen.findByText('2 of 5')).toBeInTheDocument();
    // Every card is in the one project the picker names: no label repeats it.
    const card = screen.getByText('Fixed the flaky deploy.').closest('button')!;
    expect(within(card).queryByText('api')).not.toBeInTheDocument();
  });

  it('adds nothing when the store holds global memories only', async () => {
    vi.mocked(api.stats).mockResolvedValue({ ...MIXED, total: 2, byNamespace: [{ namespace: null, count: 2 }] });
    useMemoryStore.setState({ records: [record()] });
    renderHome();
    // Let the census land before asserting that it changed nothing.
    await act(async () => {});
    expect(api.stats).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Project:/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Global')).not.toBeInTheDocument();
  });
});
