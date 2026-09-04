import { create } from 'zustand';

/**
 * Drives the "enter your API key" gate (F2). Set from lib/api.ts (any 401)
 * and hooks/useWebSocket.ts (a socket connect_error whose message indicates
 * the auth middleware rejected the handshake) — both live outside React, so
 * this is read/written via `useAuthStore.getState()` there, same pattern as
 * the existing stores.
 */
interface AuthState {
  /** True while the dashboard should show the unlock gate instead of its
   *  normal content. */
  locked: boolean;
  /** Whether a key was already stored when we got locked — distinguishes
   *  "enter a key" from "that key was wrong, try again" in the gate's copy. */
  hadKey: boolean;
  lock: (hadKey: boolean) => void;
  unlock: () => void;
  /** Clears a rejected key without dismissing the gate — the "clear a wrong
   *  key and try again" path (F2 requirement 4). Exposing the app again
   *  would just 401 immediately since nothing has been entered yet. */
  clearKey: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  locked: false,
  hadKey: false,
  lock: (hadKey) => set({ locked: true, hadKey }),
  unlock: () => set({ locked: false, hadKey: false }),
  clearKey: () => set({ hadKey: false }),
}));
