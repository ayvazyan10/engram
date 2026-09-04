import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getStoredApiKey, setStoredApiKey, clearStoredApiKey } from '../apiKey.js';

describe('apiKey sessionStorage wrapper (F2)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('returns undefined when nothing is stored', () => {
    expect(getStoredApiKey()).toBeUndefined();
  });

  it('stores and reads back a key', () => {
    setStoredApiKey('secret-123');
    expect(getStoredApiKey()).toBe('secret-123');
  });

  it('never writes to sessionStorage under a name that could collide with build output', () => {
    setStoredApiKey('secret-123');
    // The key must live in sessionStorage, not anywhere that ends up in a
    // built file — this test's real job is documented by the grep in the
    // verification step (no VITE_ENGRAM_API_KEY in dist/), but this locks
    // down that the storage mechanism is sessionStorage specifically.
    expect(sessionStorage.getItem('engram_api_key')).toBe('secret-123');
  });

  it('clears a stored key', () => {
    setStoredApiKey('secret-123');
    clearStoredApiKey();
    expect(getStoredApiKey()).toBeUndefined();
  });

  it('treats an empty string as no key', () => {
    setStoredApiKey('');
    expect(getStoredApiKey()).toBeUndefined();
  });

  describe('sessionStorage unavailable (private browsing, storage disabled by policy)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('getStoredApiKey returns undefined instead of throwing', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage disabled');
      });
      expect(() => getStoredApiKey()).not.toThrow();
      expect(getStoredApiKey()).toBeUndefined();
    });

    it('setStoredApiKey silently no-ops instead of throwing', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('storage disabled');
      });
      expect(() => setStoredApiKey('secret')).not.toThrow();
    });

    it('clearStoredApiKey silently no-ops instead of throwing', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('storage disabled');
      });
      expect(() => clearStoredApiKey()).not.toThrow();
    });
  });
});
