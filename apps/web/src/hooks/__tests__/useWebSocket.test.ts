import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { asMemoryRecord, isAuthConnectError, useWebSocket } from '../useWebSocket.js';
import { useAuthStore } from '../../store/authStore.js';

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-1',
    type: 'semantic',
    content: 'hello world',
    summary: null,
    importance: 0.5,
    source: null,
    concept: null,
    tags: '[]',
    createdAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    ...overrides,
  };
}

describe('asMemoryRecord (F1)', () => {
  it('accepts a well-formed, non-archived payload', () => {
    const payload = validPayload();
    expect(asMemoryRecord(payload)).toEqual(payload);
  });

  it('rejects payloads missing required fields', () => {
    expect(asMemoryRecord(null)).toBeNull();
    expect(asMemoryRecord(undefined)).toBeNull();
    expect(asMemoryRecord('not an object')).toBeNull();
    expect(asMemoryRecord({ id: 'x' })).toBeNull(); // missing content/type
    expect(asMemoryRecord({ ...validPayload(), content: 42 })).toBeNull();
  });

  it('drops a memory that was archived by auto-resolution in the same request', () => {
    // The server emits 'memory:stored' with the full DB row even when
    // store() reports discarded: true (auto-resolution archived it
    // immediately). Without this check the dashboard shows a phantom memory
    // that vanishes on reload.
    const payload = validPayload({ archivedAt: '2026-01-01T00:00:01.000Z' });
    expect(asMemoryRecord(payload)).toBeNull();
  });
});

describe('isAuthConnectError (F2)', () => {
  it('recognizes the server middleware\'s rejection message', () => {
    // apps/server/src/index.ts's neural namespace middleware:
    // next(new Error('Unauthorized: invalid or missing API key'))
    expect(isAuthConnectError(new Error('Unauthorized: invalid or missing API key'))).toBe(true);
  });

  it('does not flag an unrelated connection failure', () => {
    expect(isAuthConnectError(new Error('xhr poll error'))).toBe(false);
    expect(isAuthConnectError(new Error('timeout'))).toBe(false);
    expect(isAuthConnectError(null)).toBe(false);
    expect(isAuthConnectError(undefined)).toBe(false);
    expect(isAuthConnectError('not an error')).toBe(false);
  });
});

/** Minimal fake matching the handful of Socket methods useWebSocket calls. */
function fakeSocket() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.get(event)?.delete(handler);
    }),
    emit(event: string, ...args: unknown[]) {
      handlers.get(event)?.forEach((h) => h(...args));
    },
  };
}

vi.mock('../../lib/socket.js', () => ({ getSocket: () => mockSocket }));
let mockSocket: ReturnType<typeof fakeSocket>;

describe('useWebSocket auth-gate wiring (F2)', () => {
  beforeEach(() => {
    mockSocket = fakeSocket();
    useAuthStore.setState({ locked: false, hadKey: false });
  });

  it('locks the auth gate on an auth-flavored connect_error', () => {
    renderHook(() => useWebSocket());

    act(() => {
      mockSocket.emit('connect_error', new Error('Unauthorized: invalid or missing API key'));
    });

    expect(useAuthStore.getState().locked).toBe(true);
  });

  it('does not lock the gate on an unrelated connect_error', () => {
    renderHook(() => useWebSocket());

    act(() => {
      mockSocket.emit('connect_error', new Error('xhr poll error'));
    });

    expect(useAuthStore.getState().locked).toBe(false);
  });

  it('clears a stale lock once the socket connects', () => {
    useAuthStore.setState({ locked: true, hadKey: true });
    renderHook(() => useWebSocket());

    act(() => {
      mockSocket.emit('connect');
    });

    expect(useAuthStore.getState().locked).toBe(false);
  });
});
