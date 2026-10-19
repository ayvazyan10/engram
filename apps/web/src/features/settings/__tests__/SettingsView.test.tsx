import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SettingsView, { describeInterval, describeUptime } from '../SettingsView.js';
import { useTheme } from '../../../shell/theme.js';
import { api } from '../../../lib/api.js';
import { resetServerStats } from '../../../lib/serverStats.js';
import { useNeuralStore } from '../../../store/neuralStore.js';

vi.mock('../../../lib/api.js', () => ({
  api: {
    health: vi.fn(),
    stats: vi.fn(),
    getDecayPolicy: vi.fn(),
    getSyncStatus: vi.fn(),
    getEmbeddingStatus: vi.fn(),
    getIndexStatus: vi.fn(),
  },
}));

/** The value cell beside a row's label. */
function value(label: string): HTMLElement {
  const dt = screen.getByText(label, { selector: 'dt' });
  return dt.parentElement!.querySelector('dd')!;
}

beforeEach(() => {
  resetServerStats();
  useTheme.setState({ mode: 'auto' });
  useNeuralStore.setState({ isConnected: true });
  vi.mocked(api.health).mockResolvedValue({ status: 'ok', version: '0.6.0', uptime: 7300 });
  vi.mocked(api.stats).mockResolvedValue({ total: 1284, byType: {}, bySource: {}, dbPath: '/home/me/.engram/engram.db' });
  vi.mocked(api.getDecayPolicy).mockResolvedValue({ halfLifeDays: 7, archiveThreshold: 0.05, decayIntervalMs: 3_600_000 });
  vi.mocked(api.getSyncStatus).mockResolvedValue({ enabled: false });
  vi.mocked(api.getEmbeddingStatus).mockResolvedValue({
    currentModel: 'Xenova/all-MiniLM-L6-v2',
    currentDimension: 384,
    totalEmbedded: 1280,
    staleCount: 0,
    legacyCount: 0,
    dimensionMismatchCount: 0,
    needsReEmbed: false,
  });
  vi.mocked(api.getIndexStatus).mockResolvedValue({ entryCount: 1280, loadedFrom: 'disk', persisted: true });
});

describe('SettingsView', () => {
  it("shows the running server's version and uptime, not the web package's", async () => {
    render(<SettingsView />);
    expect(await screen.findByText('Engram server v0.6.0')).toBeInTheDocument();
    expect(value('Server')).toHaveTextContent('Running, v0.6.0');
    expect(screen.getByText('Up 2 hours')).toBeInTheDocument();
  });

  it('reads the database path and census from /api/stats', async () => {
    render(<SettingsView />);
    expect(await screen.findByText('/home/me/.engram/engram.db')).toBeInTheDocument();
    expect(value('Memories')).toHaveTextContent('1,284');
    expect(value('Live updates')).toHaveTextContent('Connected');
  });

  it('shows the decay policy, read-only', async () => {
    render(<SettingsView />);
    await waitFor(() => expect(value('Half-life')).toHaveTextContent('7 days'));
    expect(value('Archive below')).toHaveTextContent('5% retention');
    expect(value('Decay sweep')).toHaveTextContent('Every hour');
    expect(within(screen.getByRole('region', { name: 'Forgetting' })).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the index and the embedding model, and says when a re-embed is due', async () => {
    render(<SettingsView />);
    await waitFor(() => expect(value('Search index')).toHaveTextContent('1,280 memories indexed'));
    expect(value('Embeddings')).toHaveTextContent('Xenova/all-MiniLM-L6-v2');
    expect(screen.getByText('1,280 memories embedded, 384 dimensions')).toBeInTheDocument();
    expect(screen.getByText('Saved to disk between restarts')).toBeInTheDocument();
  });

  it('says sync is off, or how it stands when it is on', async () => {
    const { unmount } = render(<SettingsView />);
    expect(await screen.findByText(/^Off\. Set ENGRAM_SYNC_URL/)).toBeInTheDocument();
    unmount();

    vi.mocked(api.getSyncStatus).mockResolvedValue({
      enabled: true,
      state: 'error',
      lastSyncAt: null,
      pendingPushCount: 33,
      lastError: 'remote refused',
    });
    render(<SettingsView />);
    await waitFor(() => expect(value('State')).toHaveTextContent('Failing'));
    expect(value('State')).toHaveAttribute('data-state', 'bad');
    expect(value('Waiting to push')).toHaveTextContent('33');
    expect(value('Last synced')).toHaveTextContent('Not yet');
    expect(value('Last error')).toHaveTextContent('remote refused');
  });

  it('marks each read that failed, and checks again on request', async () => {
    vi.mocked(api.health).mockRejectedValueOnce(new Error('offline'));
    vi.mocked(api.getDecayPolicy).mockRejectedValueOnce(new Error('offline'));
    vi.mocked(api.getEmbeddingStatus).mockResolvedValueOnce({
      currentModel: 'm',
      currentDimension: 384,
      totalEmbedded: 3,
      staleCount: 2,
      legacyCount: 0,
      dimensionMismatchCount: 0,
      needsReEmbed: true,
    });
    useNeuralStore.setState({ isConnected: false });
    render(<SettingsView />);
    await waitFor(() => expect(value('Server')).toHaveTextContent('Not answering'));
    expect(value('Half-life')).toHaveTextContent('Could not read');
    expect(value('Live updates')).toHaveTextContent('Offline');
    expect(value('Embeddings')).toHaveAttribute('data-state', 'bad');
    expect(screen.queryByRole('heading', { name: 'About' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(value('Server')).toHaveTextContent('Running, v0.6.0'));
  });

  it('picks the colour mode with real radios, the current one checked', () => {
    render(<SettingsView />);
    expect(screen.getByRole('radio', { name: 'Match system' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(useTheme.getState().mode).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Match system' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('carries the setup steps inline, and links to watching for the next memory', () => {
    render(<SettingsView />);
    expect(screen.getByRole('tab', { name: 'Claude Code' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Watch for the next memory' })).toHaveAttribute('href', '#/welcome');
  });
});

describe('Settings wording', () => {
  it('says how often the decay sweep runs', () => {
    expect(describeInterval(undefined)).toBe('Unknown');
    expect(describeInterval(0)).toBe('Off');
    expect(describeInterval(60_000)).toBe('Every 1 minute');
    expect(describeInterval(15 * 60_000)).toBe('Every 15 minutes');
    expect(describeInterval(6 * 3_600_000)).toBe('Every 6 hours');
  });

  it('says how long the server has been up', () => {
    expect(describeUptime(60)).toBe('1 minute');
    expect(describeUptime(600)).toBe('10 minutes');
    expect(describeUptime(3600)).toBe('1 hour');
    expect(describeUptime(3 * 86400)).toBe('3 days');
  });
});
