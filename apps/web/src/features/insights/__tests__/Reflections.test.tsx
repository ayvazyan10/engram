import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReflectionsTab, { foldReflections, reflectionBody } from '../ReflectionsTab.js';
import { api } from '../../../lib/api.js';
import { useReflectionStore, type ReflectionInsight } from '../../../store/reflectionStore.js';
import { useNeuralStore } from '../../../store/neuralStore.js';

vi.mock('../../../lib/api.js', () => ({
  api: {
    getReflections: vi.fn(),
    getReflectionStatus: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const DB = 'The system moved from PostgreSQL to MongoDB as its primary database for Mission Control';

function insight(id: string, content: string, overrides: Partial<ReflectionInsight> = {}): ReflectionInsight {
  return { id, type: 'trend', content, importance: 0.7, confidence: 0.75, tags: [], createdAt: '2026-07-21T10:00:00.000Z', ...overrides };
}

beforeEach(() => {
  useReflectionStore.setState({ insights: [], status: null, loading: false, filterType: null, error: null });
  useNeuralStore.setState({ selectedNeuronId: null });
  vi.mocked(api.getReflections).mockReset().mockResolvedValue({ count: 0, reflections: [] });
  vi.mocked(api.getReflectionStatus).mockReset().mockResolvedValue({ enabled: true, due: false, counter: 2, threshold: 12 });
});

describe('folding near-identical reports', () => {
  it('folds a report into an earlier one of its kind that shares most of its words', () => {
    const groups = foldReflections([
      insight('a', `# Trend Analysis\n\n${DB}.`),
      insight('b', `${DB} now.`),
      insight('c', 'Knowledge about the deploy pipeline is thin and undocumented'),
      insight('d', `${DB}.`, { type: 'pattern' }),
    ]);
    expect(groups.map((g) => [g.lead.id, g.twins.map((t) => t.id)])).toEqual([
      ['a', ['b']],
      ['c', []],
      ['d', []],
    ]);
  });

  it('reads a report without the title lines the writer opens with', () => {
    expect(reflectionBody('# Knowledge Gap Analysis\n\n**Most Significant Gap:**\n\nNo runbook exists.')).toBe('No runbook exists.');
    expect(reflectionBody('**Most Significant Gap:** No runbook exists.\n\nSecond **paragraph**.')).toBe('No runbook exists.\n\nSecond paragraph.');
    expect(reflectionBody('# Only a title')).toBe('Only a title');
  });
});

describe('ReflectionsTab', () => {
  it('lists distinct reports, says how many were folded, and opens one as a memory', async () => {
    vi.mocked(api.getReflections).mockResolvedValue({
      count: 3,
      reflections: [insight('a', DB), insight('b', `${DB}.`, { createdAt: '2026-07-20T10:00:00.000Z' }), insight('c', 'A gap in deploy notes', { type: 'knowledge_gap' })],
    });
    render(<ReflectionsTab />);
    expect(await screen.findByText(/2 distinct reports/)).toHaveTextContent('2 distinct reports. 1 near-identical one is folded into them.');
    expect(api.getReflections).toHaveBeenCalledWith(100, undefined);
    expect(screen.getByText('The next cycle is due after 10 more stored memories. Reports cover every project.')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Open as a memory' })[1]!);
    expect(useNeuralStore.getState().selectedNeuronId).toBe('c');

    const twins = screen.getByRole('button', { name: '1 near-identical report' });
    fireEvent.click(twins);
    expect(twins).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Jul 20, 2026/ }));
    expect(useNeuralStore.getState().selectedNeuronId).toBe('b');
  });

  it('clamps a long report and shows all of it on request', async () => {
    vi.mocked(api.getReflections).mockResolvedValue({ count: 1, reflections: [insight('a', 'word '.repeat(120))] });
    render(<ReflectionsTab />);
    const more = await screen.findByRole('button', { name: /^Show all \d+ characters$/ });
    expect(document.querySelector('[data-clamped]')).not.toBeNull();
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
    expect(document.querySelector('[data-clamped]')).toBeNull();
  });

  it('filters by kind on the server, and an empty kind offers every kind', async () => {
    render(<ReflectionsTab />);
    await screen.findByRole('heading', { name: 'No reflections yet' });
    fireEvent.click(screen.getByRole('radio', { name: 'Trend' }));
    await waitFor(() => expect(api.getReflections).toHaveBeenLastCalledWith(100, 'trend'));
    expect(await screen.findByRole('heading', { name: 'No trend reports yet' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show every kind' }));
    expect(useReflectionStore.getState().filterType).toBeNull();
  });

  it('says when a cycle is due, or when reflection is off', async () => {
    vi.mocked(api.getReflectionStatus).mockResolvedValueOnce({ enabled: true, due: true, counter: 12, threshold: 12 });
    const { unmount } = render(<ReflectionsTab />);
    expect(await screen.findByText(/A reflection cycle is due: ask your AI to run request_reflection/)).toBeInTheDocument();
    unmount();
    vi.mocked(api.getReflectionStatus).mockResolvedValueOnce({ enabled: false, due: false, counter: 0, threshold: 12 });
    render(<ReflectionsTab />);
    expect(await screen.findByText(/Reflection is off on this server/)).toBeInTheDocument();
  });

  it('says why a load failed, and Try again reloads', async () => {
    vi.mocked(api.getReflections).mockRejectedValueOnce(new Error('offline'));
    render(<ReflectionsTab />);
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'No reflections yet' })).toBeInTheDocument();
  });
});
