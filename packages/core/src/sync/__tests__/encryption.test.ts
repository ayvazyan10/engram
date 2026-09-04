/**
 * Unit tests for `EncryptionManager` (`../encryption.ts`), exercised
 * against an in-memory mock of `PgSyncClient`'s sync-metadata surface.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { EncryptionManager, type EncryptableRow } from '../encryption.js';
import {
  EncryptionError,
  isEncrypted,
  encodeScryptParams,
  SCRYPT_PARAMS_CURRENT,
  SCRYPT_PARAMS_LEGACY,
} from '../crypto.js';
import type { PgSyncClient, EncryptionBootstrapRequest } from '../PgSyncClient.js';

// Simple in-memory mock for the slice of PgSyncClient that
// EncryptionManager depends on. `bootstrapEncryptionMeta` mirrors the real
// implementation's semantics: both keys are written first-wins, and the
// sentinel is derived from whichever salt actually won.
class MockPgSyncClient {
  private store = new Map<string, string>();

  async getSyncMeta(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setSyncMeta(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async bootstrapEncryptionMeta(
    request: EncryptionBootstrapRequest
  ): Promise<{ saltHex: string; kdfParams: string; sentinel: string }> {
    // Mirrors the real implementation: the KDF parameters follow the salt,
    // so a database that already had a salt but no recorded cost is treated
    // as one bootstrapped before the cost was recorded.
    const saltWasFree = !this.store.has('encryption_salt');
    const saltHex = this.firstWins('encryption_salt', request.candidateSaltHex);
    const kdfParams = this.firstWins(
      'encryption_kdf',
      saltWasFree ? request.freshKdfParams : request.legacyKdfParams
    );
    const sentinel = this.firstWins(
      'encryption_sentinel',
      await request.deriveSentinel(saltHex, kdfParams)
    );
    return { saltHex, kdfParams, sentinel };
  }

  async setEncryptionKdfParams(kdfParams: string): Promise<void> {
    this.store.set('encryption_kdf', kdfParams);
  }

  private firstWins(key: string, value: string): string {
    if (!this.store.has(key)) this.store.set(key, value);
    return this.store.get(key) as string;
  }
}

function makeManager(client: MockPgSyncClient = new MockPgSyncClient()): EncryptionManager {
  return new EncryptionManager(client as unknown as PgSyncClient);
}

function makeRow(overrides: Partial<EncryptableRow> = {}): EncryptableRow {
  return {
    id: 'memory-1',
    content: 'hello world',
    summary: 'a short summary',
    metadata: JSON.stringify({ source: 'test' }),
    tags: JSON.stringify(['a', 'b']),
    embedding: Buffer.from(new Array(768).fill(0).map((_, i) => i % 256)),
    concept: 'a concept label',
    triggerPattern: 'when the user asks about X',
    actionPattern: 'reply with Y',
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

describe('EncryptionManager.initialize — bootstrap atomicity (D4)', () => {
  it('heals a bootstrap that was interrupted between the salt write and the sentinel write', async () => {
    // A process killed after the salt landed but before the sentinel did
    // leaves salt-present / sentinel-absent. Because the salt exists, the
    // first-time-setup branch is never retried — so without a fix every
    // future initialize on every device throws WRONG_PASSPHRASE forever.
    const client = new MockPgSyncClient();
    await client.setSyncMeta('encryption_salt', randomBytes(32).toString('hex'));

    const manager = makeManager(client);
    await expect(manager.initialize('correct horse battery staple')).resolves.toBeUndefined();
    expect(manager.initialized).toBe(true);
    expect(await client.getSyncMeta('encryption_sentinel')).not.toBeNull();
  });

  it('leaves every concurrent bootstrapper holding the same key', async () => {
    // Two devices bootstrapping at once both read "no salt yet", so each
    // generates its own. Whichever salt lands last is the one every future
    // device derives from — but each bootstrapper kept the key it derived
    // from its OWN salt, so their ciphertext is mutually unreadable and the
    // surviving salt/sentinel pair can be a mismatched one.
    const client = new MockPgSyncClient();
    const managers = [makeManager(client), makeManager(client), makeManager(client),
                      makeManager(client), makeManager(client)];

    await Promise.all(managers.map((m) => m.initialize('shared passphrase')));

    const row = makeRow({ embedding: null });
    const encrypted = managers[0]!.encryptRow(row);
    for (const other of managers.slice(1)) {
      expect(other.decryptRow(encrypted)).toEqual(row);
    }
  });

  it('leaves a salt/sentinel pair a later device can verify after a concurrent bootstrap', async () => {
    const client = new MockPgSyncClient();
    await Promise.all(
      [makeManager(client), makeManager(client), makeManager(client)].map((m) =>
        m.initialize('shared passphrase')
      )
    );

    const late = makeManager(client);
    await expect(late.initialize('shared passphrase')).resolves.toBeUndefined();
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

  // beforeAll, not beforeEach: `initialize` is a scrypt derivation at the
  // current cost (~320 ms), and an initialized manager holds nothing but the
  // derived key — no test below mutates it, so one instance serves them all.
  beforeAll(async () => {
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
    // Idempotence still holds, but it is now established by opening the
    // value under our own key and binding rather than by looking for the
    // marker prefix — see `isCiphertextFor`.
    const row = makeRow();
    const encryptedOnce = manager.encryptRow(row);
    const encryptedTwice = manager.encryptRow(encryptedOnce);

    expect(encryptedTwice.content).toBe(encryptedOnce.content);
    expect(encryptedTwice.summary).toBe(encryptedOnce.summary);
    expect(encryptedTwice.metadata).toBe(encryptedOnce.metadata);
    expect(encryptedTwice.tags).toBe(encryptedOnce.tags);
  });

  it('decryptRow passes plaintext string fields through unchanged', () => {
    // String fields carry an `enc:v2:` envelope, so isEncrypted() can tell
    // plaintext from ciphertext field by field.
    const row = makeRow({ embedding: null });
    const decrypted = manager.decryptRow(row);
    expect(decrypted.content).toBe(row.content);
    expect(decrypted.summary).toBe(row.summary);
    expect(decrypted.metadata).toBe(row.metadata);
    expect(decrypted.tags).toBe(row.tags);
  });

  it('decryptRow passes a fully plaintext row through, embedding included', () => {
    // Embeddings carry no marker of their own, so whether to
    // decrypt one is read off `content` (NOT NULL, always present). A row
    // pushed by a client running without a passphrase is plaintext all the
    // way through and must be applied as-is — decrypting it unconditionally
    // failed GCM and silently dropped legacy data.
    const row = makeRow();
    expect(manager.decryptRow(row)).toEqual(row);
  });

  it('tryDecryptRow returns a fully plaintext row unchanged', () => {
    const row = makeRow();
    expect(manager.tryDecryptRow(row)).toEqual(row);
  });

  it('still fails a row whose content is ciphertext but whose embedding is not', () => {
    // A genuinely corrupt row (marked encrypted, but with bytes that are
    // not) must NOT be waved through as legacy plaintext.
    const row = makeRow();
    const tampered = { ...manager.encryptRow(row), embedding: row.embedding };
    expect(() => manager.decryptRow(tampered)).toThrow(EncryptionError);
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

// ─── S1: row-level binding, end to end ─────────────────────────────────────

describe('EncryptionManager — ciphertext is bound to its row', () => {
  let manager: EncryptionManager;

  beforeAll(async () => {
    manager = makeManager();
    await manager.initialize('correct horse battery staple');
  });

  it('refuses a row whose content was lifted from another memory', () => {
    // The server-side cut-and-paste: memory X's ciphertext pasted into
    // memory Y's row. Before binding, every client decrypted and accepted it.
    const victim = manager.encryptRow(makeRow({ id: 'memory-X', content: 'X private note' }));
    const forged = { ...victim, id: 'memory-Y' };

    expect(() => manager.decryptRow(forged)).toThrow(EncryptionError);
    expect(manager.tryDecryptRow(forged)).toBeNull();
  });

  it('refuses a row whose summary and content were swapped', () => {
    const encrypted = manager.encryptRow(makeRow({ content: 'the note', summary: 'the summary' }));
    const swapped = { ...encrypted, content: encrypted.summary as string, summary: encrypted.content };

    expect(() => manager.decryptRow(swapped)).toThrow(EncryptionError);
  });

  it('refuses an embedding lifted from another memory', () => {
    const other = manager.encryptRow(makeRow({ id: 'memory-Z' }));
    const mine = manager.encryptRow(makeRow({ id: 'memory-1' }));
    const forged = { ...mine, embedding: other.embedding };

    expect(() => manager.decryptRow(forged)).toThrow(EncryptionError);
  });

  it('refuses a session context lifted from another session', () => {
    const encrypted = manager.encryptSession({ id: 'session-A', context: '{"a":1}' });
    expect(manager.tryDecryptSession({ ...encrypted, id: 'session-B' })).toBeNull();
    expect(manager.decryptSession(encrypted).context).toBe('{"a":1}');
  });

  it('refuses connection metadata lifted from another connection', () => {
    const encrypted = manager.encryptConnection({ id: 'conn-A', metadata: '{"why":"because"}' });
    expect(manager.tryDecryptConnection({ ...encrypted, id: 'conn-B' })).toBeNull();
    expect(manager.decryptConnection(encrypted).metadata).toBe('{"why":"because"}');
  });
});

// ─── S9: content that looks like a marker ──────────────────────────────────

describe('EncryptionManager — content that impersonates the marker', () => {
  it('encrypts a memory whose content starts with enc:v1:, instead of shipping it in the clear', async () => {
    // This row used to be pushed to Postgres as plaintext (encryptRow saw
    // the prefix and skipped it) and then dropped on every pull, pinning the
    // pull cursor and stalling sync for the whole device.
    const manager = makeManager();
    await manager.initialize('a passphrase');

    const row = makeRow({ content: 'enc:v1:here is how our encryption markers work' });
    const encrypted = manager.encryptRow(row);

    expect(encrypted.content).not.toBe(row.content);
    expect(isEncrypted(encrypted.content)).toBe(true);
    expect(manager.decryptRow(encrypted)).toEqual(row);
    // The embedding rode on `content`'s status, so it was shipped in the
    // clear too.
    expect(encrypted.embedding!.equals(row.embedding!)).toBe(false);
  });

  it('round-trips a summary that starts with the marker', async () => {
    const manager = makeManager();
    await manager.initialize('a passphrase');

    const row = makeRow({ summary: 'enc:v2:not really ciphertext' });
    expect(manager.decryptRow(manager.encryptRow(row))).toEqual(row);
  });
});

// ─── S3: recorded KDF cost ─────────────────────────────────────────────────

describe('EncryptionManager — KDF parameters', () => {
  it('records the current cost when it bootstraps a fresh database', async () => {
    const client = new MockPgSyncClient();
    await makeManager(client).initialize('a passphrase');

    expect(await client.getSyncMeta('encryption_kdf')).toBe(encodeScryptParams(SCRYPT_PARAMS_CURRENT));
  });

  it('assumes the legacy cost for a database that has a salt but no recorded cost', async () => {
    // Every database bootstrapped by the shipped version looks like this.
    // Deriving at the new cost there would invalidate the stored sentinel
    // and lock the owner out of every row already encrypted under it.
    const client = new MockPgSyncClient();
    await client.setSyncMeta('encryption_salt', randomBytes(32).toString('hex'));

    const manager = makeManager(client);
    await expect(manager.initialize('a passphrase')).resolves.toBeUndefined();
    expect(await client.getSyncMeta('encryption_kdf')).toBe(encodeScryptParams(SCRYPT_PARAMS_LEGACY));
  });

  it('keeps opening a database whose sentinel was written at the legacy cost', async () => {
    const client = new MockPgSyncClient();
    await client.setSyncMeta('encryption_salt', randomBytes(32).toString('hex'));
    await makeManager(client).initialize('a passphrase');

    const later = makeManager(client);
    await expect(later.initialize('a passphrase')).resolves.toBeUndefined();
    await expect(makeManager(client).initialize('the wrong passphrase')).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE',
    });
  });

  it('recovers when the recorded cost disagrees with the sentinel, rather than locking the database', async () => {
    // A pre-KDF-metadata client bootstrapping the same fresh database
    // concurrently with a new one leaves the sentinel at the legacy cost and
    // the record at the current one. Without recovery that database could
    // never be opened by anyone again.
    const client = new MockPgSyncClient();
    await client.setSyncMeta('encryption_salt', randomBytes(32).toString('hex'));
    await makeManager(client).initialize('a passphrase'); // legacy sentinel
    await client.setSyncMeta('encryption_kdf', encodeScryptParams(SCRYPT_PARAMS_CURRENT));

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const manager = makeManager(client);
      await expect(manager.initialize('a passphrase')).resolves.toBeUndefined();
      expect(manager.initialized).toBe(true);
      // and it corrects the record so no later device pays for a derivation
      // it is going to throw away.
      expect(await client.getSyncMeta('encryption_kdf')).toBe(encodeScryptParams(SCRYPT_PARAMS_LEGACY));
    } finally {
      warn.mockRestore();
    }
  });

  it('still rejects a genuinely wrong passphrase after trying the legacy cost', async () => {
    const client = new MockPgSyncClient();
    await makeManager(client).initialize('the real passphrase');

    await expect(makeManager(client).initialize('not the passphrase')).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE',
    });
  });
});
