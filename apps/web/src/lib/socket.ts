import { io, Socket } from 'socket.io-client';
import { getStoredApiKey } from './apiKey.js';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io('/neural', {
      autoConnect: true,
      // W9: unbounded. socket.io's own default is already Infinity, but this
      // used to override it down to 5 — with the 1s-5s backoff below, that
      // gives up in roughly 15-20s. A real API restart (embeddings
      // warm-up included) can easily take longer, so the dashboard was left
      // reading "Offline" — and dropping every memory stored in the
      // meantime — until a hard reload. Set explicitly (rather than just
      // omitted) so the intent reads as deliberate, not an oversight.
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      // A function (not a static object) so the key is read fresh from
      // sessionStorage on every (re)connection attempt — not just once at
      // construction. That matters once the key can be entered at runtime
      // (F2, UnlockGate): the socket singleton is typically created before
      // any key exists, and socket.io re-invokes this before each retry, so
      // a key entered later is picked up without recreating the socket.
      // The server's neural namespace middleware rejects the handshake when
      // ENGRAM_API_KEY is set and this doesn't match (apps/server/src/index.ts).
      auth: (cb: (data: { token?: string }) => void) => {
        const key = getStoredApiKey();
        cb(key ? { token: key } : {});
      },
    });
  }
  return socket;
}

// W15: not dead — app code never calls this by design (the socket is meant
// to live for the whole tab session; useWebSocket only registers/removes
// listeners on unmount, it never tears the connection down), but it's the
// only way tests reset the module-level `socket` singleton between cases
// (see socket.test.ts's afterEach). Kept exported for that.
export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
