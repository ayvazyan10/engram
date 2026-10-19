import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Welcome, { CLIENTS, ConnectClients } from '../Welcome.js';
import { api } from '../../../lib/api.js';
import { refreshServerStats, resetServerStats } from '../../../lib/serverStats.js';
import { useMemoryStore, type MemoryRecord } from '../../../store/memoryStore.js';
import { useNeuralStore } from '../../../store/neuralStore.js';

vi.mock('../../../lib/api.js', () => ({
  api: { stats: vi.fn() },
}));

function record(id: string, content = `memory ${id}`): MemoryRecord {
  return {
    id,
    type: 'procedural',
    content,
    summary: null,
    importance: 0.5,
    source: 'claude-code',
    concept: null,
    tags: '[]',
    createdAt: '2026-10-19T12:00:00.000Z',
  };
}

const writeText = vi.fn();

beforeEach(() => {
  resetServerStats();
  vi.mocked(api.stats).mockResolvedValue({ total: 0, byType: {}, bySource: {} });
  useMemoryStore.setState({ records: [] });
  useNeuralStore.setState({ selectedNeuronId: null });
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

describe('ConnectClients', () => {
  it('offers the Claude Code plugin or engram setup, one at a time, and says never both', () => {
    render(<ConnectClients />);
    expect(screen.getByRole('tab', { name: 'Claude Code' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/never both/)).toHaveTextContent(
      'Use the plugin or engram setup, never both: with both, Engram is connected twice and every session is stored twice.'
    );
    expect(screen.getByRole('radio', { name: 'Plugin (recommended)' })).toBeChecked();
    expect(screen.getByText(/\/plugin marketplace add ayvazyan10\/engram/)).toHaveTextContent('/plugin install engram@engram');
    expect(screen.queryByText(/cli setup/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'engram setup' }));
    expect(screen.getByText('npx -y @engram-ai-memory/cli setup --npx --source claude-code')).toBeInTheDocument();
    expect(screen.queryByText(/\/plugin install/)).not.toBeInTheDocument();
  });

  it('has a config for each of the five clients, each naming itself as the source', () => {
    expect(CLIENTS.map((c) => c.name)).toEqual(['Claude Code', 'Claude Desktop', 'Cursor', 'VS Code', 'Codex CLI']);
    render(<ConnectClients />);
    for (const [name, source] of [
      ['Claude Desktop', 'claude-desktop'],
      ['Cursor', 'cursor'],
      ['VS Code', 'vscode'],
      ['Codex CLI', 'codex'],
    ] as const) {
      fireEvent.click(screen.getByRole('tab', { name }));
      expect(screen.getByRole('tabpanel')).toHaveTextContent(source);
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    }
    expect(screen.getByRole('tabpanel')).toHaveTextContent('[mcp_servers.engram]');
  });

  it('moves between clients with the arrow keys, Home and End', () => {
    render(<ConnectClients />);
    const first = screen.getByRole('tab', { name: 'Claude Code' });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Claude Desktop' })).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Claude Desktop' }));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Codex CLI' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Claude Code' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Claude Code' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement!, { key: 'x' });
  });

  it('copies the config shown, and says so when the browser blocks the clipboard', async () => {
    render(<ConnectClients />);
    fireEvent.click(screen.getByRole('tab', { name: 'Cursor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(writeText.mock.calls[0]![0]).toContain('"ENGRAM_SOURCE": "cursor"');

    writeText.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(screen.getByRole('tab', { name: 'VS Code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The browser blocked the clipboard');
  });
});

describe('Welcome', () => {
  it('waits on an empty store, then shows the first memory as it arrives', async () => {
    const onDone = vi.fn();
    render(<Welcome loading={false} onRefresh={() => {}} onDone={onDone} />);
    expect(screen.getByRole('heading', { name: 'Nothing charted yet' })).toBeInTheDocument();
    expect(screen.getByText(/Waiting for your first memory/)).toBeInTheDocument();

    act(() => useMemoryStore.setState({ records: [record('first', 'Prefer pnpm over npm')] }));
    expect(screen.getByRole('heading', { name: 'Your first memory arrived' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Prefer pnpm over npm/ }));
    expect(useNeuralStore.getState().selectedNeuronId).toBe('first');
    fireEvent.click(screen.getByRole('button', { name: 'Open the map' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('on a store that has memories, waits for the next one', async () => {
    useMemoryStore.setState({ records: [record('old')] });
    const { rerender } = render(<Welcome loading={true} onRefresh={() => {}} onDone={() => {}} />);
    rerender(<Welcome loading={false} onRefresh={() => {}} onDone={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'Connect your AI in 30 seconds' })).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the next memory/)).toBeInTheDocument();

    act(() => useMemoryStore.setState({ records: [record('new'), record('old')] }));
    expect(screen.getByRole('heading', { name: 'A new memory arrived' })).toBeInTheDocument();
  });

  it('reloads the list when the census grows, since an MCP client writes straight to the database', async () => {
    const onRefresh = vi.fn();
    vi.mocked(api.stats).mockResolvedValueOnce({ total: 0, byType: {}, bySource: {} });
    render(<Welcome loading={false} onRefresh={onRefresh} onDone={() => {}} />);
    await waitFor(() => expect(api.stats).toHaveBeenCalled());
    expect(onRefresh).not.toHaveBeenCalled();

    vi.mocked(api.stats).mockResolvedValueOnce({ total: 1, byType: {}, bySource: {} });
    await act(() => refreshServerStats());
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
