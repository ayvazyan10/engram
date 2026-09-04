import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type AuthCallback = (data: { token?: string }) => void;
type AuthOption = ((cb: AuthCallback) => void) | { token?: string } | undefined;

interface FakeSocketOpts {
  auth?: AuthOption;
  reconnectionAttempts?: number;
}

const ioMock = vi.fn((_namespace: string, _opts?: FakeSocketOpts) => ({
  disconnect: vi.fn(),
  connect: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}));
vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => ioMock(...(args as [string, FakeSocketOpts?])) }));

import { getSocket, disconnectSocket } from '../socket.js';

/** socket.io-client invokes `auth` (when it's a function) fresh before every
 *  (re)connection attempt — resolve it the same way to see what it would
 *  send on the wire right now. */
function resolveAuth(opts?: FakeSocketOpts): Promise<{ token?: string }> {
  return new Promise((resolve) => {
    if (typeof opts?.auth === 'function') {
      opts.auth((data) => resolve(data));
    } else {
      resolve(opts?.auth ?? {});
    }
  });
}

describe('lib/socket auth handshake (F2)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    disconnectSocket();
    ioMock.mockClear();
    sessionStorage.clear();
  });

  it('connects to the /neural namespace with no token when no key is stored', async () => {
    getSocket();

    expect(ioMock).toHaveBeenCalledTimes(1);
    const [namespace, opts] = ioMock.mock.calls[0]!;
    expect(namespace).toBe('/neural');
    const auth = await resolveAuth(opts);
    expect(auth.token).toBeUndefined();
  });

  it('sends the sessionStorage-stored key as auth.token', async () => {
    // The server's neural namespace middleware rejects the handshake unless
    // this matches ENGRAM_API_KEY (apps/server/src/index.ts) — without it,
    // the dashboard's connection status is stuck on "Offline" forever.
    sessionStorage.setItem('engram_api_key', 'secret-123');

    getSocket();

    const [, opts] = ioMock.mock.calls[0]!;
    const auth = await resolveAuth(opts);
    expect(auth).toEqual({ token: 'secret-123' });
  });

  it('reads the key fresh on every (re)connection attempt, not just once at construction', async () => {
    // Constructed with no key stored yet.
    getSocket();
    const [, opts] = ioMock.mock.calls[0]!;

    // The user enters a key after the socket singleton already exists —
    // this simulates socket.io re-invoking `auth` on its next automatic
    // reconnection attempt, or the explicit reconnect the unlock gate forces.
    sessionStorage.setItem('engram_api_key', 'secret-456');
    const auth = await resolveAuth(opts);

    expect(auth.token).toBe('secret-456');
  });

  it('reuses the same socket instance across calls instead of reconnecting', () => {
    const a = getSocket();
    const b = getSocket();

    expect(a).toBe(b);
    expect(ioMock).toHaveBeenCalledTimes(1);
  });
});

describe('lib/socket reconnection never gives up (W9)', () => {
  afterEach(() => {
    disconnectSocket();
    ioMock.mockClear();
  });

  it('does not cap reconnectionAttempts at a number that gives up before a real API restart finishes', () => {
    // The old cap of 5, with a 1s-5s backoff, exhausts itself in roughly
    // 15-20s — the API server (embeddings warm-up included) can take longer
    // than that to come back up, permanently stranding the dashboard on
    // "Offline" until a hard reload.
    getSocket();
    const [, opts] = ioMock.mock.calls[0]!;
    expect(opts?.reconnectionAttempts).toBe(Infinity);
  });
});
