import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../authStore.js';

describe('authStore (F2)', () => {
  beforeEach(() => {
    useAuthStore.setState({ locked: false, hadKey: false });
  });

  it('starts unlocked', () => {
    expect(useAuthStore.getState().locked).toBe(false);
  });

  it('lock(false) locks with hadKey=false — "enter a key" framing', () => {
    useAuthStore.getState().lock(false);
    expect(useAuthStore.getState()).toMatchObject({ locked: true, hadKey: false });
  });

  it('lock(true) locks with hadKey=true — "wrong key" framing', () => {
    useAuthStore.getState().lock(true);
    expect(useAuthStore.getState()).toMatchObject({ locked: true, hadKey: true });
  });

  it('unlock() clears both locked and hadKey', () => {
    useAuthStore.getState().lock(true);
    useAuthStore.getState().unlock();
    expect(useAuthStore.getState()).toMatchObject({ locked: false, hadKey: false });
  });

  it('clearKey() resets hadKey without dismissing the gate — clearing a wrong key must not expose the app', () => {
    useAuthStore.getState().lock(true);
    useAuthStore.getState().clearKey();
    expect(useAuthStore.getState()).toMatchObject({ locked: true, hadKey: false });
  });
});
