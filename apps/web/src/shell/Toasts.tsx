import { useEffect } from 'react';
import { create } from 'zustand';

export interface ToastAction {
  label: string;
  run: () => void;
}

interface Toast {
  id: number;
  message: string;
  action?: ToastAction;
}

interface ToastState {
  /** The last toast shown. It stays after hiding so the exit can animate. */
  toast: Toast | null;
  visible: boolean;
  show: (message: string, action?: ToastAction) => void;
  dismiss: () => void;
}

let nextId = 1;
const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl';

export const useToasts = create<ToastState>((set) => ({
  toast: null,
  visible: false,
  show: (message, action) => set({ toast: { id: nextId++, message, action }, visible: true }),
  dismiss: () => set({ visible: false }),
}));

/** Says what just happened, once, at the bottom of the screen. A newer
 *  toast replaces the one on screen. */
export function showToast(message: string, action?: ToastAction): void {
  useToasts.getState().show(message, action);
}

/** How long a toast stays: long enough to read, longer when it can be undone. */
export const TOAST_MS = 5000;
export const TOAST_ACTION_MS = 6000;

export default function Toasts() {
  const { toast, visible, dismiss } = useToasts();

  useEffect(() => {
    if (!visible || !toast) return;
    const timer = setTimeout(dismiss, toast.action ? TOAST_ACTION_MS : TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, visible, dismiss]);

  // ⌘Z / Ctrl+Z takes the action while its toast is up, so Undo needs no
  // trip to the bottom of the screen. A text field keeps its own undo.
  useEffect(() => {
    const action = visible ? toast?.action : undefined;
    if (!action) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'));
      if (typing || event.shiftKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      dismiss();
      action.run();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [toast, visible, dismiss]);

  return (
    <div className="at-toast" data-on={visible} role="status" aria-live="polite">
      {toast && (
        <>
          <span>{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              aria-keyshortcuts="Control+Z Meta+Z"
              title={`${toast.action.label} (${MOD_KEY}+Z)`}
              onClick={() => {
                dismiss();
                toast.action?.run();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </>
      )}
    </div>
  );
}
