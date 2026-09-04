/**
 * Unit tests for E2E encryption primitives (`../crypto.ts`). All pure
 * functions — no database required.
 */

import { describe, it, expect } from 'vitest';
import { createCipheriv, randomBytes } from 'node:crypto';
import {
  EncryptionError,
  deriveKey,
  encryptField,
  decryptField,
  isEncrypted,
  isCiphertextFor,
  encryptedFieldVersion,
  encryptEmbedding,
  decryptEmbedding,
  generateSalt,
  createSentinel,
  verifySentinel,
  encodeScryptParams,
  decodeScryptParams,
  SCRYPT_PARAMS_CURRENT,
  SCRYPT_PARAMS_LEGACY,
  type FieldBinding,
} from '../crypto.js';

/** A stand-in row binding; individual tests vary the parts they care about. */
function binding(overrides: Partial<FieldBinding> = {}): FieldBinding {
  return { table: 'memories', id: 'mem-1', column: 'content', ...overrides };
}

const BINDING = binding();

/**
 * A key derived once for the whole file.
 *
 * scrypt at the current cost is ~320 ms a call, and most tests here only
 * need *a* valid key rather than a freshly salted one — deriving per test
 * added half a minute of CI time for no extra coverage. Tests that genuinely
 * care about salt or cost variation still call `deriveKey` directly.
 */
let sharedKey: Promise<Buffer> | null = null;
function testKey(): Promise<Buffer> {
  sharedKey ??= deriveKey('passphrase', Buffer.alloc(32, 7));
  return sharedKey;
}

let otherKeyPromise: Promise<Buffer> | null = null;
function otherTestKey(): Promise<Buffer> {
  otherKeyPromise ??= deriveKey('a different passphrase', Buffer.alloc(32, 7));
  return otherKeyPromise;
}

/**
 * Builds the pre-AAD `v1` envelope exactly as the shipped version did:
 * AES-256-GCM with no associated data. Rows in that format are sitting in
 * every existing sync database, so `decryptField` has to keep opening them
 * and these helpers are how that stays tested once nothing writes v1.
 */
function legacyV1EmbeddingEnvelope(plain: Buffer, key: Buffer): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([nonce, encrypted, cipher.getAuthTag()]);
}

function legacyV1Envelope(plaintext: string, key: Buffer): string {
  return legacyV1EmbeddingEnvelope(Buffer.from(plaintext, 'utf8'), key).toString('base64');
}

describe('deriveKey', () => {
  it('produces a 32-byte Buffer', async () => {
    const salt = generateSalt();
    const key = await deriveKey('correct horse battery staple', salt);
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it('is deterministic for the same passphrase and salt', async () => {
    const salt = generateSalt();
    const key1 = await deriveKey('same passphrase', salt);
    const key2 = await deriveKey('same passphrase', salt);
    expect(key1.equals(key2)).toBe(true);
  });

  it('differs for different passphrases', async () => {
    const salt = generateSalt();
    const key1 = await deriveKey('passphrase one', salt);
    const key2 = await deriveKey('passphrase two', salt);
    expect(key1.equals(key2)).toBe(false);
  });

  it('differs for different salts', async () => {
    const key1 = await deriveKey('same passphrase', generateSalt());
    const key2 = await deriveKey('same passphrase', generateSalt());
    expect(key1.equals(key2)).toBe(false);
  });
});

describe('encryptField / decryptField', () => {
  it('round-trips plaintext', async () => {
    const key = await testKey();
    const plaintext = 'The quick brown fox jumps over the lazy dog.';
    const ciphertext = encryptField(plaintext, key, BINDING);
    expect(decryptField(ciphertext, key, BINDING)).toBe(plaintext);
  });

  it('isEncrypted returns true for an encrypted value', async () => {
    const key = await testKey();
    const ciphertext = encryptField('hello world', key, BINDING);
    expect(isEncrypted(ciphertext)).toBe(true);
  });

  it('produces different ciphertexts for the same plaintext (nonce uniqueness)', async () => {
    const key = await testKey();
    const a = encryptField('repeat me', key, BINDING);
    const b = encryptField('repeat me', key, BINDING);
    expect(a).not.toBe(b);
  });

  it('throws EncryptionError with code DECRYPT_FAILED for the wrong key', async () => {
    const key = await testKey();
    const wrongKey = await otherTestKey();
    const ciphertext = encryptField('secret message', key, BINDING);

    expect(() => decryptField(ciphertext, wrongKey, BINDING)).toThrow(EncryptionError);
    try {
      decryptField(ciphertext, wrongKey, BINDING);
      expect.unreachable('decryptField should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EncryptionError);
      expect((error as EncryptionError).code).toBe('DECRYPT_FAILED');
    }
  });

  it('throws MALFORMED_CIPHERTEXT for a value with no prefix', async () => {
    const key = await testKey();
    try {
      decryptField('not-a-valid-ciphertext', key, BINDING);
      expect.unreachable('decryptField should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EncryptionError);
      expect((error as EncryptionError).code).toBe('MALFORMED_CIPHERTEXT');
    }
  });

  it('throws for truncated base64', async () => {
    const key = await testKey();
    const ciphertext = encryptField('some plaintext', key, BINDING);
    const truncated = ciphertext.slice(0, ciphertext.length - 10);
    expect(() => decryptField(truncated, key, BINDING)).toThrow(EncryptionError);
  });

  it('throws MALFORMED_CIPHERTEXT for an unknown version prefix (enc:v3:)', async () => {
    const key = await testKey();
    try {
      decryptField('enc:v3:AAAA', key, BINDING);
      expect.unreachable('decryptField should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EncryptionError);
      expect((error as EncryptionError).code).toBe('MALFORMED_CIPHERTEXT');
    }
  });

  it('handles unicode content (emoji, CJK)', async () => {
    const key = await testKey();
    const plaintext = 'Hello 🌍🔒 世界 こんにちは 안녕하세요 emoji: 🚀🎉🧠';
    const ciphertext = encryptField(plaintext, key, BINDING);
    expect(decryptField(ciphertext, key, BINDING)).toBe(plaintext);
  });

  it('handles an empty string', async () => {
    const key = await testKey();
    const ciphertext = encryptField('', key, BINDING);
    expect(decryptField(ciphertext, key, BINDING)).toBe('');
  });

  it('handles large content (50KB+)', async () => {
    const key = await testKey();
    const plaintext = 'x'.repeat(50 * 1024 + 137);
    const ciphertext = encryptField(plaintext, key, BINDING);
    expect(decryptField(ciphertext, key, BINDING)).toBe(plaintext);
  });
});

describe('isEncrypted', () => {
  it('returns false for plaintext', () => {
    expect(isEncrypted('just a plain string')).toBe(false);
  });

  it('returns true for an encrypted value', async () => {
    const key = await testKey();
    expect(isEncrypted(encryptField('hi', key, BINDING))).toBe(true);
  });

  it('returns false for an unknown version prefix', () => {
    expect(isEncrypted('enc:v3:AAAA')).toBe(false);
  });
});

describe('encryptEmbedding / decryptEmbedding', () => {
  it('round-trips a 768-byte buffer (384-dim FP16)', async () => {
    const key = await testKey();
    const plainBuffer = Buffer.alloc(768);
    for (let i = 0; i < plainBuffer.length; i++) {
      plainBuffer[i] = i % 256;
    }

    const encrypted = encryptEmbedding(plainBuffer, key, BINDING);
    const decrypted = decryptEmbedding(encrypted, key, BINDING);
    expect(decrypted.equals(plainBuffer)).toBe(true);
  });

  it('throws for the wrong key', async () => {
    const key = await testKey();
    const wrongKey = await otherTestKey();
    const plainBuffer = Buffer.alloc(768, 7);
    const encrypted = encryptEmbedding(plainBuffer, key, BINDING);

    expect(() => decryptEmbedding(encrypted, wrongKey, BINDING)).toThrow(EncryptionError);
  });

  it('throws MALFORMED_CIPHERTEXT for a too-short buffer (<28 bytes)', async () => {
    const key = await testKey();
    const tooShort = Buffer.alloc(27);
    try {
      decryptEmbedding(tooShort, key, BINDING);
      expect.unreachable('decryptEmbedding should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EncryptionError);
      expect((error as EncryptionError).code).toBe('MALFORMED_CIPHERTEXT');
    }
  });
});

describe('generateSalt', () => {
  it('returns a 32-byte Buffer', () => {
    const salt = generateSalt();
    expect(Buffer.isBuffer(salt)).toBe(true);
    expect(salt.length).toBe(32);
  });

  it('produces different salts across calls', () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(a.equals(b)).toBe(false);
  });
});

describe('createSentinel / verifySentinel', () => {
  it('round-trips successfully', async () => {
    const key = await testKey();
    const sentinel = createSentinel(key);
    expect(verifySentinel(sentinel, key)).toBe(true);
  });

  it('returns false for the wrong key', async () => {
    const key = await testKey();
    const wrongKey = await otherTestKey();
    const sentinel = createSentinel(key);

    expect(verifySentinel(sentinel, wrongKey)).toBe(false);
  });
});

// ─── S1: associated data binds a ciphertext to its row and column ───────────

describe('associated data (enc:v2)', () => {
  it('refuses to decrypt a ciphertext moved to a different row id', async () => {
    // The cut-and-paste a database operator can perform: lift memory X's
    // `content` into memory Y's row. Without binding, every client decrypts
    // and accepts it.
    const key = await testKey();
    const ciphertext = encryptField('X private note', key, binding({ id: 'memory-X' }));

    expect(() => decryptField(ciphertext, key, binding({ id: 'memory-Y' }))).toThrow(EncryptionError);
    try {
      decryptField(ciphertext, key, binding({ id: 'memory-Y' }));
      expect.unreachable('decryptField should have thrown');
    } catch (error) {
      expect((error as EncryptionError).code).toBe('DECRYPT_FAILED');
    }
  });

  it('refuses to decrypt a ciphertext moved to a different column', async () => {
    // Swapping `summary` and `content` inside one row.
    const key = await testKey();
    const ciphertext = encryptField('the full note', key, binding({ column: 'content' }));

    expect(() => decryptField(ciphertext, key, binding({ column: 'summary' }))).toThrow(EncryptionError);
  });

  it('refuses to decrypt a ciphertext moved to a different table', async () => {
    const key = await testKey();
    const ciphertext = encryptField('a value', key, binding({ table: 'memories' }));

    expect(() => decryptField(ciphertext, key, binding({ table: 'sessions' }))).toThrow(EncryptionError);
  });

  it('binds embeddings to their row too', async () => {
    const key = await testKey();
    const plain = Buffer.alloc(768, 3);
    const encrypted = encryptEmbedding(plain, key, binding({ id: 'memory-X', column: 'embedding' }));

    expect(
      decryptEmbedding(encrypted, key, binding({ id: 'memory-X', column: 'embedding' })).equals(plain)
    ).toBe(true);
    expect(() =>
      decryptEmbedding(encrypted, key, binding({ id: 'memory-Y', column: 'embedding' }))
    ).toThrow(EncryptionError);
  });

  it('writes the v2 marker and reports it', async () => {
    const key = await testKey();
    const ciphertext = encryptField('hello', key, BINDING);
    expect(ciphertext.startsWith('enc:v2:')).toBe(true);
    expect(encryptedFieldVersion(ciphertext)).toBe('v2');
  });

  it('still reads a v1 value, which was written without associated data', async () => {
    // Forward compatibility for rows already on the server. A v1 envelope
    // has no AAD, so it opens under any binding — that is exactly the
    // weakness v2 closes, and exactly why v1 must keep working until those
    // rows are rewritten.
    const key = await testKey();
    const legacy = 'enc:v1:' + legacyV1Envelope('legacy plaintext', key);

    expect(encryptedFieldVersion(legacy)).toBe('v1');
    expect(decryptField(legacy, key, binding({ id: 'any-row' }))).toBe('legacy plaintext');
  });

  it('reads a v1 embedding when told the row is v1', async () => {
    const key = await testKey();
    const plain = Buffer.alloc(64, 9);
    const legacy = legacyV1EmbeddingEnvelope(plain, key);

    expect(decryptEmbedding(legacy, key, null).equals(plain)).toBe(true);
    expect(() => decryptEmbedding(legacy, key, BINDING)).toThrow(EncryptionError);
  });
});

// ─── S9: user content cannot impersonate the encryption marker ─────────────

describe('marker impersonation', () => {
  it('does not mistake prose that merely starts with the marker for ciphertext', () => {
    // This used to be pushed to the server in plaintext and then dropped on
    // every pull, pinning the pull cursor and stalling sync for the device.
    expect(isEncrypted('enc:v1:here is how our encryption markers work')).toBe(false);
    expect(isEncrypted('enc:v2:see the enc:v2: prefix?')).toBe(false);
    expect(isEncrypted('enc:v1:')).toBe(false);
    expect(isEncrypted('enc:v1:AAAA')).toBe(false); // valid base64, far too short
  });

  it('isCiphertextFor rejects a hand-crafted envelope that authenticates under nothing', async () => {
    const key = await testKey();
    // Structurally perfect: right prefix, valid base64, long enough. Only
    // the auth tag gives it away, which is why the encrypt path checks it.
    const forged = 'enc:v2:' + Buffer.alloc(40, 1).toString('base64');
    expect(isEncrypted(forged)).toBe(true);
    expect(isCiphertextFor(forged, key, BINDING)).toBe(false);
  });

  it('isCiphertextFor accepts a genuine ciphertext for the same binding only', async () => {
    const key = await testKey();
    const ciphertext = encryptField('real', key, binding({ id: 'memory-X' }));

    expect(isCiphertextFor(ciphertext, key, binding({ id: 'memory-X' }))).toBe(true);
    expect(isCiphertextFor(ciphertext, key, binding({ id: 'memory-Y' }))).toBe(false);
  });
});

// ─── S3: recorded KDF parameters ───────────────────────────────────────────

describe('scrypt parameters', () => {
  it('the current cost meets the OWASP minimum, and the legacy cost is what shipped', () => {
    expect(SCRYPT_PARAMS_CURRENT).toEqual({ N: 2 ** 17, r: 8, p: 1 });
    expect(SCRYPT_PARAMS_LEGACY).toEqual({ N: 2 ** 15, r: 8, p: 1 });
  });

  it('round-trips through encode/decode', () => {
    expect(decodeScryptParams(encodeScryptParams(SCRYPT_PARAMS_CURRENT))).toEqual(SCRYPT_PARAMS_CURRENT);
    expect(decodeScryptParams(encodeScryptParams(SCRYPT_PARAMS_LEGACY))).toEqual(SCRYPT_PARAMS_LEGACY);
  });

  it('derives a different key at a different cost, which is why the cost must be recorded', async () => {
    const salt = generateSalt();
    const current = await deriveKey('same passphrase', salt, SCRYPT_PARAMS_CURRENT);
    const legacy = await deriveKey('same passphrase', salt, SCRYPT_PARAMS_LEGACY);
    expect(current.equals(legacy)).toBe(false);
  });

  it('refuses parameters weaker than the legacy cost — a hostile server must not downgrade us', () => {
    for (const weak of [1024, 4096, 16384]) {
      expect(() => decodeScryptParams(JSON.stringify({ kdf: 'scrypt', N: weak, r: 8, p: 1 })))
        .toThrow(EncryptionError);
    }
  });

  it('refuses parameters large enough to be a memory-exhaustion switch', () => {
    expect(() => decodeScryptParams(JSON.stringify({ kdf: 'scrypt', N: 2 ** 30, r: 8, p: 1 })))
      .toThrow(EncryptionError);
  });

  it('refuses a non-power-of-two N, an unknown kdf, and malformed JSON', () => {
    expect(() => decodeScryptParams(JSON.stringify({ kdf: 'scrypt', N: 100000, r: 8, p: 1 })))
      .toThrow(EncryptionError);
    expect(() => decodeScryptParams(JSON.stringify({ kdf: 'argon2id', N: 2 ** 17, r: 8, p: 1 })))
      .toThrow(EncryptionError);
    expect(() => decodeScryptParams('not json')).toThrow(EncryptionError);
  });

  it('reports BAD_KDF_PARAMS rather than a generic failure', () => {
    try {
      decodeScryptParams('not json');
      expect.unreachable('decodeScryptParams should have thrown');
    } catch (error) {
      expect((error as EncryptionError).code).toBe('BAD_KDF_PARAMS');
    }
  });
});
