import { showToast } from '../../shell/Toasts.js';

/** How long an action can be taken back before its call is sent. */
export const UNDO_MS = 6000;

export interface DeferredAction {
  /** What the toast says happened, e.g. "Archived." */
  message: string;
  /** Sends the call. `keepalive` is true when the page is going away, so the
   *  request must outlive it. */
  commit: (keepalive: boolean) => Promise<unknown>;
  /** Puts back what the action hid. */
  undo: () => void;
  /** The call failed after the undo window: put things back and say so. */
  onError: (err: unknown) => void;
}

interface Pending {
  timer: ReturnType<typeof setTimeout>;
  action: DeferredAction;
}

const pending = new Map<number, Pending>();
let nextId = 1;

function send(action: DeferredAction, keepalive: boolean): void {
  action.commit(keepalive).catch((err: unknown) => action.onError(err));
}

/**
 * Archive with an undo, client side (the server has no restore yet): the
 * caller hides the item at once, the toast offers Undo for six seconds, and
 * only then is the call sent. Closing or reloading the page inside that
 * window sends it straight away with `keepalive`, so nothing is lost by
 * leaving.
 */
export function deferAction(action: DeferredAction): void {
  const id = nextId++;
  const timer = setTimeout(() => {
    pending.delete(id);
    send(action, false);
  }, UNDO_MS);
  pending.set(id, { timer, action });
  showToast(action.message, {
    label: 'Undo',
    run: () => {
      const entry = pending.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(id);
      action.undo();
    },
  });
}

/** Sends every action still waiting, now. Runs when the page is hidden for good. */
export function flushDeferred(): void {
  for (const { timer, action } of pending.values()) {
    clearTimeout(timer);
    send(action, true);
  }
  pending.clear();
}

window.addEventListener('pagehide', flushDeferred);
