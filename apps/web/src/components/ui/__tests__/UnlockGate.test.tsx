import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UnlockGate from '../UnlockGate.js';
import { useAuthStore } from '../../../store/authStore.js';
import { getStoredApiKey } from '../../../lib/apiKey.js';

describe('UnlockGate (F2)', () => {
  const originalLocation = window.location;
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    useAuthStore.setState({ locked: true, hadKey: false });
    // jsdom's window.location.reload isn't configurable, so vi.spyOn can't
    // replace it in place — swap the whole `location` object instead.
    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    sessionStorage.clear();
  });

  it('shows "enter a key" copy, with no clear-key affordance, when no key was stored yet', () => {
    useAuthStore.setState({ locked: true, hadKey: false });
    render(<UnlockGate />);

    expect(screen.getByText(/api key required/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear key/i })).not.toBeInTheDocument();
  });

  it('shows "wrong key" copy and a clear-key affordance when a key was already stored', () => {
    useAuthStore.setState({ locked: true, hadKey: true });
    render(<UnlockGate />);

    expect(screen.getByText(/wrong key/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear key/i })).toBeInTheDocument();
  });

  it('is visibly distinct from an empty state or a generic error banner — it asks for input, not just text', () => {
    render(<UnlockGate />);
    expect(screen.getByPlaceholderText(/api key/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unlock/i })).toBeInTheDocument();
  });

  it('stores the entered key and reloads on submit', () => {
    render(<UnlockGate />);

    fireEvent.change(screen.getByPlaceholderText(/api key/i), { target: { value: '  my-secret-key  ' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    expect(getStoredApiKey()).toBe('my-secret-key');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('does not submit an empty key', () => {
    render(<UnlockGate />);

    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    expect(getStoredApiKey()).toBeUndefined();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('submits on Enter as well as the button click', () => {
    render(<UnlockGate />);

    fireEvent.change(screen.getByPlaceholderText(/api key/i), { target: { value: 'enter-key' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/api key/i), { key: 'Enter' });

    expect(getStoredApiKey()).toBe('enter-key');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('clearing a wrong key resets to the "enter a key" state without dismissing the gate — no reload, no wedge', () => {
    sessionStorage.setItem('engram_api_key', 'the-wrong-key');
    useAuthStore.setState({ locked: true, hadKey: true });
    render(<UnlockGate />);

    fireEvent.click(screen.getByRole('button', { name: /clear key/i }));

    expect(getStoredApiKey()).toBeUndefined();
    expect(useAuthStore.getState()).toMatchObject({ locked: true, hadKey: false });
    expect(reloadSpy).not.toHaveBeenCalled();
    // The gate must still be interactible — the "wrong key" framing is gone
    // and the input is ready for a fresh attempt.
    expect(screen.getByText(/api key required/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/api key/i)).toHaveValue('');
  });
});
