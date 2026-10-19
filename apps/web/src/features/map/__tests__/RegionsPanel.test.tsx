import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import MapSheet from '../MapSheet.js';
import { NAMES_KEY, useMapStore } from '../mapStore.js';
import { buildModel } from '../lib/model.js';
import { useMemoryStore, type MemoryRecord } from '../../../store/memoryStore.js';
import { useNeuralStore } from '../../../store/neuralStore.js';
import { resetServerStats } from '../../../lib/serverStats.js';
import { api } from '../../../lib/api.js';
import { payload } from './payload.js';

vi.mock('../../../lib/api.js', () => ({
  api: { stats: vi.fn(), search: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const onRegion = vi.fn();
const props = { loading: false, error: null, onRetry: vi.fn(), onLoadMore: vi.fn(), loadingMore: false, onStore: vi.fn(), onRegion };

function record(id: string): MemoryRecord {
  return { id, type: 'semantic', content: `Memory ${id}`, summary: null, importance: 0.5, source: null, concept: null, tags: '[]', createdAt: '2026-10-18T00:00:00.000Z' };
}

beforeEach(() => {
  onRegion.mockReset();
  localStorage.clear();
  resetServerStats();
  vi.mocked(api.stats).mockReset().mockResolvedValue({ total: 5, byType: {}, bySource: {} });
  useNeuralStore.setState({ selectedNeuronId: null });
  useMemoryStore.setState({ records: [record('a'), record('d')], searchQuery: '', searchResults: [], weakerResults: [], projectFilter: undefined, hiddenIds: new Set() });
  const p = payload();
  useMapStore.setState({ status: 'ready', payload: p, model: buildModel(p), regionId: null, panel: 'recent', hoverId: null, names: {} });
});

const regionsTab = () => screen.getByRole('button', { name: 'Regions', pressed: false });

describe('MapSheet: Regions', () => {
  it('lists every region as a button: size, reflections, contradictions, what is new', () => {
    render(<MapSheet {...props} />);
    fireEvent.click(regionsTab());
    expect(screen.getByRole('heading', { name: '2 regions' })).toBeInTheDocument();
    const sync = screen.getByRole('button', { name: /^Sync · encryption/ });
    expect(sync).toHaveTextContent('33% reflections');
    expect(sync).toHaveTextContent('1 contradiction');
    expect(sync).toHaveTextContent('Quiet this week');
    expect(screen.getByRole('button', { name: /^Release · npm/ })).toHaveTextContent('2 new this week');
    fireEvent.click(sync);
    expect(onRegion).toHaveBeenCalledWith('r1');
  });

  it('says the regions come with the map while it is charted', () => {
    useMapStore.setState({ model: null, status: 'pending' });
    render(<MapSheet {...props} />);
    fireEvent.click(regionsTab());
    expect(screen.getByText(/It is being charted now/)).toBeInTheDocument();
  });

  it('shows an open region: its make-up and its memories, each opening the memory', () => {
    useMapStore.setState({ regionId: 'r1', panel: 'regions' });
    render(<MapSheet {...props} />);
    expect(screen.getByRole('heading', { name: 'Sync · encryption' })).toBeInTheDocument();
    expect(screen.getByText('3 memories, 1 reflection, 1 contradiction')).toBeInTheDocument();
    const rows = screen.getAllByRole('button', { name: /^(Sync is end to end encrypted|Trend analysis|Memory c)/ });
    expect(rows[0]).toHaveTextContent('Sync is end to end encrypted');
    fireEvent.click(rows[0]!);
    expect(useNeuralStore.getState().selectedNeuronId).toBe('a');
    fireEvent.click(screen.getByRole('button', { name: 'All regions' }));
    expect(onRegion).toHaveBeenCalledWith(null);
  });

  it('renames a region on this device, and gives it its automatic name back', () => {
    useMapStore.setState({ regionId: 'r1', panel: 'regions' });
    render(<MapSheet {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename Sync · encryption' }));
    const input = screen.getByLabelText('Name on this device');
    expect(input).toHaveValue('Sync · encryption');
    fireEvent.change(input, { target: { value: 'Cloud sync' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(screen.getByRole('heading', { name: 'Cloud sync' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(NAMES_KEY)!)).toEqual({ r1: 'Cloud sync' });

    fireEvent.click(screen.getByRole('button', { name: 'Rename Cloud sync' }));
    fireEvent.keyDown(screen.getByLabelText('Name on this device'), { key: 'Escape' });
    expect(screen.getByRole('heading', { name: 'Cloud sync' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rename Cloud sync' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use “sync · encryption”' }));
    expect(screen.getByRole('heading', { name: 'Sync · encryption' })).toBeInTheDocument();
    expect(localStorage.getItem(NAMES_KEY)).toBe('{}');

    fireEvent.click(screen.getByRole('button', { name: 'Rename Sync · encryption' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Name on this device')).not.toBeInTheDocument();
  });

  it('switches back to Recent', () => {
    render(<MapSheet {...props} />);
    fireEvent.click(regionsTab());
    fireEvent.click(screen.getByRole('button', { name: 'Recent', pressed: false }));
    expect(screen.getByRole('heading', { name: 'Recent memories' })).toBeInTheDocument();
  });
});

describe('MapSheet and the map point at the same memory', () => {
  it('rings on the map the memory under the pointer in the list', () => {
    render(<MapSheet {...props} />);
    const list = screen.getByRole('region', { name: 'Recent memories' });
    fireEvent.pointerOver(within(list).getByRole('button', { name: /Memory d/ }));
    expect(useMapStore.getState().hoverId).toBe('d');
    fireEvent.pointerLeave(list.querySelector('.mp-body')!);
    expect(useMapStore.getState().hoverId).toBeNull();
  });

  it('marks the row of the memory under the pointer on the map', () => {
    render(<MapSheet {...props} />);
    const row = screen.getByRole('button', { name: /Memory a/ });
    expect(row).not.toHaveAttribute('data-hover');
    act(() => useMapStore.setState({ hoverId: 'a' }));
    expect(screen.getByRole('button', { name: /Memory a/ })).toHaveAttribute('data-hover');
  });
});
