import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { useNeuronDerivedState } from '../NeuronMesh.js';
import { useNeuralStore } from '../../../store/neuralStore.js';
import { useMemoryStore } from '../../../store/memoryStore.js';

describe('useNeuronDerivedState narrow selectors (F5)', () => {
  beforeEach(() => {
    useNeuralStore.setState({
      selectedNeuronId: null,
      activeNeuronIds: new Set(),
      contradictionIds: new Set(),
      isConnected: false,
    });
    useMemoryStore.setState({
      searchQuery: '',
      highlightedIds: new Set(),
    });
  });

  it('does not re-render when an unrelated store field changes (setConnected)', () => {
    const renderSpy = vi.fn();
    renderHook(() => {
      renderSpy();
      return useNeuronDerivedState('n1');
    });
    expect(renderSpy).toHaveBeenCalledTimes(1);

    act(() => {
      useNeuralStore.getState().setConnected(true);
    });

    // A whole-store subscription (the pre-F5 bug) would re-render every
    // NeuronMesh here even though nothing this node displays changed.
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  it('re-renders exactly once when this node becomes selected, and not again for an unrelated re-select', () => {
    const renderSpy = vi.fn();
    const { result } = renderHook(() => {
      renderSpy();
      return useNeuronDerivedState('n1');
    });
    expect(result.current.isSelected).toBe(false);

    act(() => {
      useNeuralStore.getState().selectNeuron('n1');
    });
    expect(renderSpy).toHaveBeenCalledTimes(2);
    expect(result.current.isSelected).toBe(true);

    act(() => {
      useNeuralStore.getState().selectNeuron('other-node');
    });
    expect(renderSpy).toHaveBeenCalledTimes(3);
    expect(result.current.isSelected).toBe(false);
  });

  it('does not re-render when a different node is highlighted by search, but does when this one is', () => {
    // Pre-seed with an unrelated id already highlighted so `hasAnyHighlights`
    // (which every node legitimately depends on, for dimming) is already
    // true before we start counting — isolating the per-id behavior below.
    useMemoryStore.setState({ searchQuery: 'foo', highlightedIds: new Set(['seed']) });

    const renderSpy = vi.fn();
    const { result } = renderHook(() => {
      renderSpy();
      return useNeuronDerivedState('n1');
    });
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(result.current.isHighlighted).toBe(false);

    act(() => {
      useMemoryStore.getState().setHighlightedIds(new Set(['seed', 'some-other-node']));
    });
    // n1 isn't in the set before or after, and the set is non-empty both
    // times — no re-render. A whole-store subscription (the pre-F5 bug)
    // would re-render every node here on a search result touching none of
    // them.
    expect(renderSpy).toHaveBeenCalledTimes(1);

    act(() => {
      useMemoryStore.getState().setHighlightedIds(new Set(['n1']));
    });
    expect(renderSpy).toHaveBeenCalledTimes(2);
    expect(result.current.isHighlighted).toBe(true);
  });
});
