import { useEffect, useId, useRef, type ReactNode } from 'react';
import './ui.css';

const FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Dialog width. Defaults to the Store Memory form's 480px. */
  width?: string;
}

/** Focus-trapped Atlas dialog. Escape closes only this dialog. An outside
 * click closes it only when the pointer also started outside, so dragging
 * a text selection out of the dialog never discards the draft. */
export default function ModalShell({ title, onClose, children, footer, width = '480px' }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const overlayMouseDownRef = useRef(false);
  const titleId = useId();
  // Capture before children's autoFocus runs during mount.
  const opener = useRef(document.activeElement as HTMLElement | null);

  useEffect(() => {
    const dialog = dialogRef.current!;
    if (!dialog.contains(document.activeElement)) dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    const back = opener.current;
    return () => { if (back?.isConnected) back.focus(); };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Let the shell know this Escape was handled, preserving selection.
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (!dialogRef.current.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
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
      className="ui-overlay"
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
        className="ui-modal"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ui-modal-header">
          <span id={titleId} className="ui-modal-title">{title}</span>
          <button className="ec-hover-tint ui-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 16 16" fill="none" style={{ width: 12, height: 12 }} aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="ui-modal-body">{children}</div>

        {footer && <div className="ui-modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
