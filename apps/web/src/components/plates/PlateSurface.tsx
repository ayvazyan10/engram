import { useLayoutEffect, useRef, useState } from 'react';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useViewStore } from '../../store/viewStore.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import type { ObsData } from '../../lib/plate/contract.js';

/**
 * The plate box: the app's canvas slot, measured, with the active plate in it.
 *
 * A plate is handed a box in CSS pixels and draws to exactly that — every one
 * of the five sizes its own geometry from `width`/`height` rather than from
 * the viewport, and four of the five root themselves `position: absolute;
 * inset: 0`. Both facts make this component's two jobs load-bearing:
 *
 *   the box is `position: relative` (`.ec-plate`, styles/plate.css), or an
 *   `inset: 0` root resolves against the VIEWPORT and the plate covers the
 *   header, the memory list and the inspector — and since one of those roots
 *   is also its pointer surface, it swallows every click over them;
 *
 *   the box is measured with a ResizeObserver and re-measured on every
 *   resize, exactly as the harness did, because the numbers a plate prints
 *   about itself are laid out against the size it was told.
 *
 * There is nothing else in here. No key, no legend, no denominator strip: each
 * plate states its own denominators inside its own box (contract rule 8), and
 * the app's scene key was retired rather than left to disagree with them.
 */

interface Props {
  data: ObsData | null;
  error: string | null;
  onRetry: () => void;
}

/** The box in CSS pixels, tracked across resizes. */
function useBoxSize(): [React.RefObject<HTMLDivElement | null>, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const box = entry.contentRect;
      setSize({ width: Math.round(box.width), height: Math.round(box.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

export default function PlateSurface({ data, error, onRetry }: Props) {
  const activeView = useViewStore((s) => s.activeView);
  const selectedId = useNeuralStore((s) => s.selectedNeuronId);
  const selectNeuron = useNeuralStore((s) => s.selectNeuron);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [boxRef, size] = useBoxSize();

  const Plate = activeView.Plate;

  return (
    <div className="ec-plate" ref={boxRef}>
      {error ? (
        <PlateMessage onRetry={onRetry}>
          The store did not answer: {error}. Every figure on a plate is derived from what the
          server actually returned, so nothing is drawn rather than something invented.
        </PlateMessage>
      ) : !data ? (
        <div className="ec-plate-state">
          {/* The same spinner the rest of the app loads with (@keyframes
              ec-spin, styles/global.css), in plate ink because it is inside
              the plate's box. It covers the whole load, not just part of it:
              an empty box while the projection is in flight looked identical
              to an empty store. */}
          <span className="ec-plate-spinner" aria-hidden="true" />
          <p className="ec-plate-state-text">Reading the store.</p>
        </div>
      ) : size.width > 0 && size.height > 0 ? (
        <Plate
          data={data}
          width={size.width}
          height={size.height}
          reducedMotion={reducedMotion}
          selectedId={selectedId}
          onSelect={selectNeuron}
        />
      ) : null}
    </div>
  );
}

function PlateMessage({ children, onRetry }: { children: React.ReactNode; onRetry: () => void }) {
  return (
    <div className="ec-plate-state">
      <p className="obs-note ec-plate-state-note">{children}</p>
      <button type="button" className="ec-plate-retry" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
