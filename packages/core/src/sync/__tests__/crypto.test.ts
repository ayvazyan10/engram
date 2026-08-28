/**
 * Unit tests for E2E encryption primitives (`../crypto.ts`). All pure
 * functions — no database required.
 */

import { describe, it, expect } from 'vitest';
import {
  EncryptionError,
  deriveKey,
  encryptField,
  decryptField,
  isEncrypted,
  encryptEmbedding,
  decryptEmbedding,
  generateSalt,
  createSentinel,
  verifySentinel,
} from '../crypto.js';

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
    const key = await deriveKey('passphrase', generateSalt());
    const plaintext = 'The quick brown fox jumps over the lazy dog.';
    const ciphertext = encryptField(plaintext, key);
    expect(decryptField(ciphertext, key)).toBe(plaintext);
  });

  it('isEncrypted returns true for an encrypted value', async () => {
    const key = await deriveKey('passphrase', generateSalt());
    const ciphertext = encryptField('hello world', key);
    expect(isEncrypted(ciphertext)).toBe(true);
  });

  it('produces different ciphertexts for the same plaintext (nonce uniqueness)', async () => {
    const key = await deriveKey('passphrase', generateSalt());
    const a = encryptField('repeat me', key);
    const b = encryptField('repeat me', key);
    expect(a).not.toBe(b);
  });

  it('throws EncryptionError with code DECRYPT_FAILED for the wrong key', async () => {
    const salt = generateSalt();
    const key = await deriveKey('correct passphrase', salt);
    const wrongKey = await deriveKey('wrong passphrase', salt);
    const ciphertext = encryptField('secret message', key);

    expect(() => decryptField(ciphertext, wrongKey)).toThrow(EncryptionError);
    try {
      decryptField(ciphertext, wrongKey);
      expect.unreachable('decryptField should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EncryptionError);
      expect((error as EncryptionError).code).toBe('DECRYPT_FAILED');
    }
  });

  it('throws MALFORMED_CIPHERTEXT for a value with no prefix', async () => {
    const key = await deriveKey('passphrase', generateSalt());
    try {
      decryptField('not-a-valid-ciphertext', key);
      expect.unreachable('decryptField should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EncryptionError);
      expect((error as EncryptionError).code).toBe('MALFORMED_CIPHERTEXT');
    }
  });

  it('throws for truncated base64', async () => {
    const key = await deriveKey('passphrase', generateSalt());
    const ciphertext = encryptField('some plaintext', key);
    const truncated = ciphertext.slice(0, ciphertext.length - 10);
    expect(() => decryptField(truncated, key)).toThrow(EncryptionError);
  });

  it('throws MALFORMED_CIPHERTEXT for a wrong version prefix (enc:v2:)', async () => {
    const key = await deriveKey('passphrase', generateSalt());
    try {
      decryptField('enc:v2:AAAA', key);
      expect.unreachable('decryptField should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EncryptionError);
      expect((error as EncryptionError).code).toBe('MALFORMED_CIPHERTEXT');
    }
  });

  it('handles unicode content (emoji, CJK)', async () => {
    const key = await deriveKey('passphrase', generateSalt());
    const plaintext = 'Hello 🌍🔒 世界 こんにちは 안녕하세요 emoji: 🚀🎉🧠';
    const ciphertext = encryptField(plaintext, key);
    expect(decryptField(ciphertext, key)).toBe(plaintext);
  });

  it('handles an empty string', async () => {
    const key = await deriveKey('passphrase', generateSalt());
    const ciphertext = encryptField('', key);
    expect(decryptField(ciphertext, key)).toBe('');
  });

  it('handles large content (50KB+)', async () => {
    const key = await deriveKey('passphrase', generateSalt());
    const plaintext = 'x'.repeat(50 * 1024 + 137);
    const ciphertext = encryptField(plaintext, key);
    expect(decryptField(ciphertext, key)).toBe(plaintext);
  });
});

describe('isEncrypted', () => {
  it('returns false for plaintext', () => {
    expect(isEncrypted('just a plain string')).toBe(false);
  });

  it('returns true for an encrypted value', async () => {
    const key = await deriveKey('passphrase', generateSalt());
    expect(isEncrypted(encryptField('hi', key))).toBe(true);
  });

  it('returns false for an enc:v2: prefixed value', () => {
    expect(isEncrypted('enc:v2:AAAA')).toBe(false);
  });
});

describe('encryptEmbedding / decryptEmbedding', () => {
  it('round-trips a 768-byte buffer (384-dim FP16)', async () => {
    const key = await deriveKey('passphrase', generateSalt());
    const plainBuffer = Buffer.alloc(768);
    for (let i = 0; i < plainBuffer.length; i++) {
      plainBuffer[i] = i % 256;
    }

    const encrypted = encryptEmbedding(plainBuffer, key);
    const decrypted = decryptEmbedding(encrypted, key);
    expect(decrypted.equals(plainBuffer)).toBe(true);
  });

  it('throws for the wrong key', async () => {
    const salt = generateSalt();
    const key = await deriveKey('correct passphrase', salt);
    const wrongKey = await deriveKey('wrong passphrase', salt);
    const plainBuffer = Buffer.alloc(768, 7);
    const encrypted = encryptEmbedding(plainBuffer, key);

    expect(() => decryptEmbedding(encrypted, wrongKey)).toThrow(EncryptionError);
  });

  it('throws MALFORMED_CIPHERTEXT for a too-short buffer (<28 bytes)', async () => {
    const key = await deriveKey('passphrase', generateSalt());
    const tooShort = Buffer.alloc(27);
    try {
      decryptEmbedding(tooShort, key);
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
    const key = await deriveKey('passphrase', generateSalt());
    const sentinel = createSentinel(key);
    expect(verifySentinel(sentinel, key)).toBe(true);
  });

  it('returns false for the wrong key', async () => {
    const salt = generateSalt();
    const key = await deriveKey('correct passphrase', salt);
    const wrongKey = await deriveKey('wrong passphrase', salt);
    const sentinel = createSentinel(key);

    expect(verifySentinel(sentinel, wrongKey)).toBe(false);
  });
});
