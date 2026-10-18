import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTemplateStore } from '../../store/templateStore.js';
import { RADIUS, SPACE, TYPE, WEIGHT } from '../../lib/tokens.js';

const FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Dialog width. Defaults to the Store Memory form's 480px. */
  width?: string;
}

/**
 * The themed, focus-trapped dialog shell.
 *
 * Extracted from StoreMemoryModal so the archive confirmation can reuse it
 * rather than fall back to a native `confirm()` (H8) — which showed OS
 * chrome, ignored the template entirely, and on some browsers prefixed the
 * message with the page origin.
 *
 * The two behaviours that took real work to get right come with it:
 *
 *  - Escape closes, and Tab is trapped inside the dialog instead of reaching
 *    the background (which stayed fully tabbable before W7).
 *  - A click on the overlay only counts as "outside" if the drag that
 *    produced it ALSO started on the overlay. A text selection dragged
 *    inside the dialog and released outside it fires a click whose target is
 *    the overlay (the browser resolves click to the nearest common ancestor
 *    of mousedown/mouseup, not either endpoint) — which used to close the
 *    dialog and lose whatever had been typed.
 */
export default function ModalShell({ title, onClose, children, footer, width = '480px' }: Props) {
  const t = useTemplateStore((s) => s.activeTemplate);
  const dialogRef = useRef<HTMLDivElement>(null);
  const overlayMouseDownRef = useRef(false);
  const titleId = useId();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Marked handled so the host's Escape (AppLayout, which clears the
        // plate selection) stands down: one keystroke closes the dialog and
        // nothing behind it. The archive confirmation used to close AND wipe
        // the selected memory it was confirming.
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      style={styles.overlay}
      onMouseDown={(e) => { overlayMouseDownRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target === e.currentTarget && overlayMouseDownRef.current) onClose();
        overlayMouseDownRef.current = false;
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ ...styles.modal, width, background: t.cardBg, borderColor: t.panelBorder }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ ...styles.header, borderBottomColor: t.panelBorder }}>
          <span id={titleId} style={{ ...styles.title, color: t.textPrimary }}>{title}</span>
          <button className="ec-hover-tint" style={{ ...styles.closeBtn, background: t.inputBg, borderColor: t.panelBorder, color: t.textSecondary }} onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 16 16" fill="none" style={{ width: 12, height: 12 }} aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div style={styles.body}>{children}</div>

        {footer && <div style={{ ...styles.footer, borderTopColor: t.panelBorder }}>{footer}</div>}
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed' as const, inset: 0, zIndex: 1000,
    background: 'rgba(2, 6, 16, 0.62)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: SPACE.lg,
  },
  // The one surface in the app that floats, so the one that carries a real
  // shadow: a long soft drop plus a 1px dark seat, which separates the card
  // from the blurred scene behind it in every template.
  modal: {
    maxWidth: '90vw', maxHeight: '90vh',
    border: '1px solid', borderRadius: RADIUS.xl,
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0, 0, 0, 0.35)',
    display: 'flex', flexDirection: 'column' as const, overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md,
    padding: `${SPACE.md} ${SPACE.xl}`, borderBottom: '1px solid',
  },
  title: { fontSize: TYPE.lg, fontWeight: WEIGHT.semibold, letterSpacing: '-0.01em' },
  closeBtn: {
    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: '1px solid', borderRadius: RADIUS.sm, flexShrink: 0,
  },
  body: { padding: SPACE.xl, display: 'flex', flexDirection: 'column' as const, gap: SPACE.lg, overflowY: 'auto' as const },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: SPACE.sm,
    padding: `${SPACE.md} ${SPACE.xl}`, borderTop: '1px solid',
  },
} as const;
