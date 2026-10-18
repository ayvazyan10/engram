import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Onboarding, { CLIENTS } from '../Onboarding.js';
import { useWebSocket } from '../../../hooks/useWebSocket.js';
import { useMemoryStore } from '../../../store/memoryStore.js';
import { resetServerStats } from '../../../lib/serverStats.js';

vi.mock('../../../lib/api.js', () => ({
  api: { stats: vi.fn().mockResolvedValue({ total: 0, byType: {}, bySource: {} }) },
}));

/** Minimal fake of the Socket methods useWebSocket calls (as in useWebSocket.test.ts). */
function fakeSocket() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.get(event)?.delete(handler);
    }),
    emit(event: string, ...args: unknown[]) {
      handlers.get(event)?.forEach((h) => h(...args));
    },
  };
}

vi.mock('../../../lib/socket.js', () => ({ getSocket: () => mockSocket }));
let mockSocket: ReturnType<typeof fakeSocket>;

/** The live wiring AppLayout provides: the socket hook beside the view. */
function Live({ onDone = () => {} }: { onDone?: () => void }) {
  useWebSocket();
  return <Onboarding onRefresh={() => {}} onDone={onDone} />;
}

describe('Onboarding', () => {
  beforeEach(() => {
    mockSocket = fakeSocket();
    resetServerStats();
    useMemoryStore.setState({ records: [], searchResults: [], searchQuery: '' });
  });

  it('is titled for the job and offers the five clients as tabs', () => {
    render(<Live />);
    expect(screen.getByRole('heading', { name: 'Connect your AI in 30 seconds' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['Claude Code', 'Claude Desktop', 'Cursor', 'VS Code', 'Codex CLI']);
    expect(screen.getByRole('tab', { name: 'Claude Code' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the exact Claude Code command first', () => {
    render(<Live />);
    expect(screen.getByRole('tabpanel')).toHaveTextContent(
      'claude mcp add engram -s user -e ENGRAM_DB_PATH=$HOME/.engram/engram.db -e ENGRAM_SOURCE=claude-code -- npx -y -p @engram-ai-memory/mcp@latest engram-mcp'
    );
  });

  it('gives each client its own config shape', () => {
    render(<Live />);
    const panel = () => screen.getByRole('tabpanel');

    fireEvent.click(screen.getByRole('tab', { name: 'Claude Desktop' }));
    expect(panel()).toHaveTextContent('claude_desktop_config.json');
    expect(panel()).toHaveTextContent('"mcpServers"');

    fireEvent.click(screen.getByRole('tab', { name: 'Cursor' }));
    expect(panel()).toHaveTextContent('~/.cursor/mcp.json');
    expect(panel()).toHaveTextContent('"mcpServers"');

    fireEvent.click(screen.getByRole('tab', { name: 'VS Code' }));
    expect(panel()).toHaveTextContent('.vscode/mcp.json');
    expect(panel()).toHaveTextContent('"servers"');
    expect(panel()).toHaveTextContent('"type": "stdio"');

    fireEvent.click(screen.getByRole('tab', { name: 'Codex CLI' }));
    expect(panel()).toHaveTextContent('config.toml');
    expect(panel()).toHaveTextContent('[mcp_servers.engram]');
  });

  it('copies the selected client config', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Live />);
    fireEvent.click(screen.getByRole('tab', { name: 'VS Code' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(writeText).toHaveBeenCalledWith(CLIENTS.find((c) => c.id === 'vscode')!.code);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('states the server URL and whether an API key is required', () => {
    render(<Live />);
    expect(screen.getByText(window.location.origin)).toBeInTheDocument();
    expect(screen.getByText('Not required')).toBeInTheDocument();
  });

  it('completes the waiting step when memory:stored arrives, and shows that memory', () => {
    const onDone = vi.fn();
    render(<Live onDone={onDone} />);
    expect(screen.getByText('Waiting for your first memory…')).toBeInTheDocument();

    act(() => {
      mockSocket.emit('memory:stored', {
        id: 'mem-first',
        type: 'semantic',
        content: 'The user prefers pnpm over npm.',
        summary: null,
        importance: 0.5,
        source: 'claude-code',
        concept: null,
        tags: '[]',
        createdAt: new Date().toISOString(),
        archivedAt: null,
      });
    });

    expect(screen.queryByText('Waiting for your first memory…')).not.toBeInTheDocument();
    expect(screen.getByText('Your first memory arrived')).toBeInTheDocument();
    expect(screen.getByText('The user prefers pnpm over npm.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Go to your memories' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
