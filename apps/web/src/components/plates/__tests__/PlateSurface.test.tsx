import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import PlateSurface from '../PlateSurface.js';
import { useNeuralStore } from '../../../store/neuralStore.js';
import { useMemoryStore } from '../../../store/memoryStore.js';
import { useViewStore, DEFAULT_VIEW_ID } from '../../../store/viewStore.js';
import { highlightIndices, type DemoModule, type DemoProps, type ObsData } from '../../../lib/plate/contract.js';

/**
 * The box, not the drawings.
 *
 * Every plate is handed a width and a height in CSS pixels and lays itself out
 * against those, and four of the five root themselves `position: absolute;
 * inset: 0`. So the two things worth locking here are that the box is measured
 * and that it is a containing block — an `inset: 0` root inside an unpositioned
 * parent resolves against the VIEWPORT, which puts the plate over the header,
 * the memory list and the inspector, and (since one of those roots is also its
 * pointer surface) swallows every click over them.
 */

/** A stand-in plate: records what it was handed, and nothing else. */
let handed: DemoProps | null = null;
const stub: DemoModule = {
  id: 'stub',
  name: 'Stub plate',
  dimension: '2D',
  caption: 'A stand-in that records its props.',
  method: 'It renders an empty div so the box can be asserted without a WebGL context.',
  Plate: (props: DemoProps) => {
    handed = props;
    return <div data-testid="stub-plate" />;
  },
};

const emptyData = {
  nodes: [],
  links: [],
  halfExtent: 42,
  stats: { memories: 0 },
} as unknown as ObsData;

/** jsdom gives every element a zero box; PlateSurface draws a plate only once
 *  the box is real, so a test that wants the plate has to supply a size. */
function withBox(width: number, height: number) {
  const spy = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) });
  return () => spy.mockRestore();
}

describe('PlateSurface', () => {
  beforeEach(() => {
    handed = null;
    useViewStore.setState({ activeViewId: stub.id, activeView: stub });
    useNeuralStore.setState({ selectedNeuronId: null });
  });

  it('is a positioned box — an inset:0 plate root must resolve against it, not the viewport', () => {
    render(<PlateSurface data={emptyData} error={null} onRetry={() => {}} />);
    // The class is the contract with styles/plate.css, which is asserted in
    // styles/__tests__/plateCss.test.ts.
    expect(document.querySelector('.ec-plate')).toBeInTheDocument();
  });

  it('hands the plate the measured box, the data and the shared selection', () => {
    const restore = withBox(900, 640);
    useNeuralStore.setState({ selectedNeuronId: 'mem-7' });
    render(<PlateSurface data={emptyData} error={null} onRetry={() => {}} />);

    expect(screen.getByTestId('stub-plate')).toBeInTheDocument();
    expect(handed?.width).toBe(900);
    expect(handed?.height).toBe(640);
    expect(handed?.data).toBe(emptyData);
    expect(handed?.selectedId).toBe('mem-7');
    expect(typeof handed?.reducedMotion).toBe('boolean');
    restore();
  });

  /** SearchBar wrote these and nothing read them: search hits never reached a plate. */
  it("hands the plate the search's hits", () => {
    const restore = withBox(900, 640);
    const hits = new Set(['mem-2', 'mem-9']);
    useMemoryStore.setState({ highlightedIds: hits });
    render(<PlateSurface data={emptyData} error={null} onRetry={() => {}} />);

    expect(handed?.highlightedIds).toBe(hits);
    useMemoryStore.setState({ highlightedIds: new Set() });
    restore();
  });

  it('turns the hits into node indices, the form each plate colours by', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect([...highlightIndices(nodes, new Set(['c', 'a', 'gone']))].sort()).toEqual([0, 2]);
    expect(highlightIndices(nodes, new Set()).size).toBe(0);
  });

  it('wires onSelect to the store the inspector reads, so a click on a plate fills it', () => {
    const restore = withBox(800, 600);
    render(<PlateSurface data={emptyData} error={null} onRetry={() => {}} />);

    act(() => handed!.onSelect('mem-3'));
    expect(useNeuralStore.getState().selectedNeuronId).toBe('mem-3');
    restore();
  });

  it('renders nothing but a message before the data arrives', () => {
    render(<PlateSurface data={null} error={null} onRetry={() => {}} />);
    expect(screen.queryByTestId('stub-plate')).not.toBeInTheDocument();
    expect(screen.getByText(/reading the store/i)).toBeInTheDocument();
  });

  /** W13's invariant, moved with the spinner: a static ring reads as a frozen
   *  app. */
  it('gives the loading spinner an animation', () => {
    render(<PlateSurface data={null} error={null} onRetry={() => {}} />);
    // The rule lives in styles/plate.css (jsdom applies no stylesheet), so
    // this asserts the element the rule targets is actually rendered.
    expect(document.querySelector('.ec-plate-spinner')).toBeInTheDocument();
  });

  /** A failed load must not look like an empty store — the whole reason the
   *  fallback sphere was removed rather than left silent. */
  it('states a failed load in words, with the server\'s own message and a way back', () => {
    const onRetry = vi.fn();
    render(<PlateSurface data={null} error="API 500: /graph/layout" onRetry={onRetry} />);

    expect(screen.getByText(/API 500: \/graph\/layout/)).toBeInTheDocument();
    expect(screen.queryByText(/reading the store/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('stub-plate')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the plate caption, and its method only behind the "?"', () => {
    render(<PlateSurface data={emptyData} error={null} onRetry={() => {}} />);
    expect(screen.getByText(stub.caption)).toBeInTheDocument();
    expect(screen.queryByText(stub.method)).not.toBeInTheDocument();

    const help = screen.getByRole('button', { name: `How ${stub.name} is built` });
    expect(help).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(help);
    expect(help).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(stub.method)).toBeInTheDocument();

    fireEvent.click(help);
    expect(screen.queryByText(stub.method)).not.toBeInTheDocument();
  });

  it('draws no key of its own — each plate states its own denominators', () => {
    const restore = withBox(900, 640);
    render(<PlateSurface data={emptyData} error={null} onRetry={() => {}} />);
    expect(screen.queryByRole('button', { name: /scene key/i })).not.toBeInTheDocument();
    restore();
    useViewStore.getState().setView(DEFAULT_VIEW_ID);
  });
});
