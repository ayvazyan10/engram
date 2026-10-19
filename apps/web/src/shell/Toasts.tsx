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

  return (
    <div className="at-toast" data-on={visible} role="status" aria-live="polite">
      {toast && (
        <>
          <span>{toast.message}</span>
          {toast.action && (
            <button
              type="button"
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
