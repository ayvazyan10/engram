import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { VIEWS, useViewStore } from '../../store/viewStore.js';

/** Space between the chip and the drawer, and the drawer's minimum clearance
 *  from the window edges. */
const DROP = 7;
const EDGE = 12;

interface Placement {
  top: number;
  right: number;
  maxHeight: number;
}

/**
 * Where the drawer lands.
 *
 * It is placed against the WINDOW rather than against the chip, because the
 * header wraps: below 860px the mode tabs lose their labels and the whole bar
 * reflows, so a drawer anchored to the chip's own box ends up hanging off the
 * left edge of a phone. Aligned to the chip's right edge where there is room,
 * clamped to the window where there is not.
 */
function placeDrawer(anchor: DOMRect): Placement {
  const width = Math.min(760, innerWidth - 2 * EDGE);
  const rightmost = Math.max(EDGE, innerWidth - EDGE - width);
  return {
    top: anchor.bottom + DROP,
    right: Math.min(Math.max(EDGE, innerWidth - anchor.right), rightmost),
    maxHeight: Math.max(200, innerHeight - anchor.bottom - DROP - EDGE),
  };
}

/**
 * The plate chooser — the app's primary navigation.
 *
 * Each of the five plates ships a plain-language `caption`: what it shows
 * and how to read it. A name and a caption do not fit five times in a 48px
 * header strip, and a `title` tooltip hides them from touch, so the header
 * carries the short form (which plate is up) and opening it drops the long
 * form: five rows, each the plate's name against its caption.
 *
 * On a compact viewport the chooser is not in the header at all — it sits in
 * the caption strip on the plate surface (PlateSurface).
 *
 * Everything visible is the plate's own material — its ground, its ink, its
 * two faces (styles/plate.css, `.plate-pick-*`). That is the one deliberate
 * move: the control that picks the plate is cut from the plate, so it reads as
 * belonging to the surface below it rather than to the chrome around it.
 * Selection is ground and ink weight, never a hue — inside this system hue
 * means link kind and nothing else, and a third colour here would be a colour
 * with no meaning.
 *
 * Nothing about the five is named here. Every word comes off the plate's own
 * module export, so the chooser cannot describe a plate differently from how
 * the plate describes itself.
 */
export default function PlateChooser() {
  const { activeViewId, activeView, setView } = useViewStore();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const panelId = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  // Measured before paint, so the drawer never appears at the wrong place and
  // then jumps. A resize closes it rather than chasing the new geometry.
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const anchor = buttonRef.current?.getBoundingClientRect();
    if (anchor) setPlacement(placeDrawer(anchor));
    const onResize = () => setOpen(false);
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, [open]);

  // A pointer anywhere outside closes. `pointerdown` rather than `click` so
  // the drawer is gone before whatever was clicked underneath reacts.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Opening lands on the plate that is already up, so the drawer opens at the
  // reader's own position rather than at the top of a list.
  useEffect(() => {
    if (!open) return;
    const index = VIEWS.findIndex((v) => v.id === activeViewId);
    optionRefs.current[Math.max(0, index)]?.focus();
  }, [open, activeViewId]);

  const choose = useCallback(
    (id: string) => {
      setView(id);
      close(true);
    },
    [setView, close]
  );

  /**
   * One key handler for the whole control, on the wrapper, so it sees the
   * trigger and every row.
   *
   * Escape calls `preventDefault`. AppLayout binds a window-level Escape that
   * clears the memory selection; React's handler runs at the root container,
   * which is a descendant of window, so this marks the event handled before
   * that listener sees it. Closing the drawer must not also throw away what
   * the reader had selected.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        if (!open) return;
        event.preventDefault();
        close(true);
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        const focused = optionRefs.current.findIndex((el) => el === document.activeElement);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next = (focused + step + VIEWS.length) % VIEWS.length;
        optionRefs.current[next]?.focus();
      }
    },
    [open, close]
  );

  return (
    <div className="plate-pick" ref={wrapRef} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="plate-pick-button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Plate: ${activeView.name}, ${activeView.dimension}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="plate-pick-name">{activeView.name}</span>
        <span className="obs-label" aria-hidden="true">
          {activeView.dimension}
        </span>
        <span className="plate-pick-caret" aria-hidden="true">
          ▼
        </span>
      </button>

      {open && (
        <div
          className="plate-pick-panel"
          id={panelId}
          role="group"
          aria-label="Choose a plate"
          style={placement ?? undefined}
        >
          {VIEWS.map((view, i) => (
            <button
              key={view.id}
              ref={(el) => {
                optionRefs.current[i] = el;
              }}
              type="button"
              className="plate-pick-option"
              aria-pressed={view.id === activeViewId}
              onClick={() => choose(view.id)}
            >
              <span className="plate-pick-option-head">
                <span className="plate-pick-option-name">{view.name}</span>
                <span className="obs-label">{view.dimension}</span>
              </span>
              <p className="plate-pick-option-claim">{view.caption}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
