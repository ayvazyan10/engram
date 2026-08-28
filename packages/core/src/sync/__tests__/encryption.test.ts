/**
 * Unit tests for `EncryptionManager` (`../encryption.ts`), exercised
 * against an in-memory mock of `PgSyncClient`'s sync-metadata surface.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EncryptionManager, type EncryptableRow } from '../encryption.js';
import { EncryptionError, isEncrypted } from '../crypto.js';
import type { PgSyncClient } from '../PgSyncClient.js';

// Simple in-memory mock for PgSyncClient — EncryptionManager only depends
// on getSyncMeta/setSyncMeta, so that's all the mock needs to implement.
class MockPgSyncClient {
  private store = new Map<string, string>();

  async getSyncMeta(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setSyncMeta(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

function makeManager(client: MockPgSyncClient = new MockPgSyncClient()): EncryptionManager {
  return new EncryptionManager(client as unknown as PgSyncClient);
}

function makeRow(overrides: Partial<EncryptableRow> = {}): EncryptableRow {
  return {
    content: 'hello world',
    summary: 'a short summary',
    metadata: JSON.stringify({ source: 'test' }),
    tags: JSON.stringify(['a', 'b']),
    embedding: Buffer.from(new Array(768).fill(0).map((_, i) => i % 256)),
    ...overrides,
  };
}

describe('EncryptionManager.initialize', () => {
  it('first-time setup stores salt and sentinel in the client', async () => {
    const client = new MockPgSyncClient();
    const manager = makeManager(client);

    await manager.initialize('correct horse battery staple');

    const salt = await client.getSyncMeta('encryption_salt');
    const sentinel = await client.getSyncMeta('encryption_sentinel');
    expect(salt).not.toBeNull();
    expect(sentinel).not.toBeNull();
  });

  it('second call with the same passphrase succeeds', async () => {
    const client = new MockPgSyncClient();
    const first = makeManager(client);
    await first.initialize('correct horse battery staple');

    const second = makeManager(client);
    await expect(second.initialize('correct horse battery staple')).resolves.toBeUndefined();
    expect(second.initialized).toBe(true);
  });

  it('second call with a wrong passphrase throws WRONG_PASSPHRASE', async () => {
    const client = new MockPgSyncClient();
    const first = makeManager(client);
    await first.initialize('correct horse battery staple');

    const second = makeManager(client);
    await expect(second.initialize('totally different passphrase')).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE',
    });
    await expect(second.initialize('totally different passphrase')).rejects.toBeInstanceOf(EncryptionError);
  });

  it('initialized is false before initialize and true after', async () => {
    const manager = makeManager();
    expect(manager.initialized).toBe(false);

    await manager.initialize('a passphrase');
    expect(manager.initialized).toBe(true);
  });
});

describe('EncryptionManager guards', () => {
  it('encryptRow throws if not initialized', () => {
    const manager = makeManager();
    expect(() => manager.encryptRow(makeRow())).toThrow(EncryptionError);
  });

  it('decryptRow throws if not initialized', () => {
    const manager = makeManager();
    expect(() => manager.decryptRow(makeRow())).toThrow(EncryptionError);
  });
});

describe('EncryptionManager round-trip', () => {
  let manager: EncryptionManager;

  beforeEach(async () => {
    manager = makeManager();
    await manager.initialize('correct horse battery staple');
  });

  it('round-trips all fields', () => {
    const row = makeRow();
    const encrypted = manager.encryptRow(row);
    const decrypted = manager.decryptRow(encrypted);
    expect(decrypted).toEqual(row);
  });

  it('round-trips with null summary/metadata/tags', () => {
    const row = makeRow({ summary: null, metadata: null, tags: null });
    const encrypted = manager.encryptRow(row);
    expect(encrypted.summary).toBeNull();
    expect(encrypted.metadata).toBeNull();
    expect(encrypted.tags).toBeNull();

    const decrypted = manager.decryptRow(encrypted);
    expect(decrypted).toEqual(row);
  });

  it('round-trips with an embedding buffer', () => {
    const embedding = Buffer.from(new Array(768).fill(0).map((_, i) => (i * 7) % 256));
    const row = makeRow({ embedding });
    const encrypted = manager.encryptRow(row);

    expect(encrypted.embedding).not.toBeNull();
    expect(encrypted.embedding!.equals(embedding)).toBe(false);
    // nonce (12) + auth tag (16) overhead on top of the original length.
    expect(encrypted.embedding!.length).toBe(embedding.length + 28);

    const decrypted = manager.decryptRow(encrypted);
    expect(decrypted.embedding!.equals(embedding)).toBe(true);
  });

  it('does not double-encrypt already-encrypted content', () => {
    const row = makeRow();
    const encryptedOnce = manager.encryptRow(row);
    const encryptedTwice = manager.encryptRow(encryptedOnce);

    expect(encryptedTwice.content).toBe(encryptedOnce.content);
    expect(encryptedTwice.summary).toBe(encryptedOnce.summary);
    expect(encryptedTwice.metadata).toBe(encryptedOnce.metadata);
    expect(encryptedTwice.tags).toBe(encryptedOnce.tags);
  });

  it('decryptRow passes plaintext string fields through unchanged', () => {
    // No embedding here: string fields are marked with an `enc:v1:` prefix
    // so isEncrypted() can distinguish plaintext from ciphertext, but raw
    // embedding buffers carry no such marker (see the embedding-specific
    // tests below for that behavior).
    const row = makeRow({ embedding: null });
    const decrypted = manager.decryptRow(row);
    expect(decrypted.content).toBe(row.content);
    expect(decrypted.summary).toBe(row.summary);
    expect(decrypted.metadata).toBe(row.metadata);
    expect(decrypted.tags).toBe(row.tags);
  });

  it('decryptRow throws when the embedding is plaintext, not ciphertext', () => {
    // Embeddings have no encrypted-marker prefix like string fields do, so
    // decryptRow always attempts to decrypt them — a plaintext embedding
    // fails GCM auth-tag verification and surfaces as a thrown error.
    const row = makeRow();
    expect(() => manager.decryptRow(row)).toThrow(EncryptionError);
  });

  it('tryDecryptRow returns null when the embedding is plaintext, not ciphertext', () => {
    const row = makeRow();
    expect(manager.tryDecryptRow(row)).toBeNull();
  });

  it('decryptRow with the wrong key throws', async () => {
    const row = makeRow();
    const encrypted = manager.encryptRow(row);

    const otherClient = new MockPgSyncClient();
    const otherManager = makeManager(otherClient);
    await otherManager.initialize('a completely different passphrase');

    expect(() => otherManager.decryptRow(encrypted)).toThrow(EncryptionError);
  });

  it('tryDecryptRow returns null on failure instead of throwing', async () => {
    const row = makeRow();
    const encrypted = manager.encryptRow(row);

    const otherClient = new MockPgSyncClient();
    const otherManager = makeManager(otherClient);
    await otherManager.initialize('a completely different passphrase');

    expect(otherManager.tryDecryptRow(encrypted)).toBeNull();
  });

  it('tryDecryptRow returns the decrypted row on success', () => {
    const row = makeRow();
    const encrypted = manager.encryptRow(row);
    expect(manager.tryDecryptRow(encrypted)).toEqual(row);
  });

  it('two managers with the same passphrase on the same client can cross-decrypt', async () => {
    const client = new MockPgSyncClient();
    const managerA = makeManager(client);
    await managerA.initialize('shared passphrase');

    const managerB = makeManager(client);
    await managerB.initialize('shared passphrase');

    const row = makeRow();
    const encrypted = managerA.encryptRow(row);
    const decrypted = managerB.decryptRow(encrypted);
    expect(decrypted).toEqual(row);
  });

  it('unicode content survives an encrypt/decrypt round-trip', () => {
    const row = makeRow({ content: '日本語のテスト 🎉 emoji and áccents' });
    const encrypted = manager.encryptRow(row);
    expect(isEncrypted(encrypted.content)).toBe(true);
    const decrypted = manager.decryptRow(encrypted);
    expect(decrypted.content).toBe(row.content);
  });

  it('empty string content survives an encrypt/decrypt round-trip', () => {
    const row = makeRow({ content: '' });
    const encrypted = manager.encryptRow(row);
    expect(isEncrypted(encrypted.content)).toBe(true);
    const decrypted = manager.decryptRow(encrypted);
    expect(decrypted.content).toBe('');
  });
});
