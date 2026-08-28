/**
 * EncryptionManager wires the E2E encryption primitives in `./crypto.ts` to
 * a `PgSyncClient` for salt/sentinel persistence, and exposes a small
 * row-level API (`encryptRow` / `decryptRow`) that the sync push/pull paths
 * use to encrypt memory fields before they leave the device and decrypt
 * them after they arrive.
 *
 * See `.claude/PRPs/plans/postgres-cloud-sync.md` for the sync design this
 * module supports.
 */

import {
  deriveKey,
  encryptField,
  decryptField,
  isEncrypted,
  encryptEmbedding,
  decryptEmbedding,
  generateSalt,
  createSentinel,
  verifySentinel,
  EncryptionError,
} from './crypto.js';
import type { PgSyncClient } from './PgSyncClient.js';

/** sync_metadata key holding the hex-encoded scrypt salt. */
const SALT_META_KEY = 'encryption_salt';
/** sync_metadata key holding the encrypted sentinel value. */
const SENTINEL_META_KEY = 'encryption_sentinel';

/** Fields on a memory row that get encrypted before push. */
export interface EncryptableRow {
  content: string;
  summary: string | null;
  metadata: string | null; // JSON string
  tags: string | null; // JSON string
  embedding: Buffer | null;
}

/**
 * Derives and holds the AES-256 key used to encrypt/decrypt memory rows for
 * sync, deriving it from a user passphrase and a salt persisted in Postgres
 * via `PgSyncClient`. A sentinel value (also persisted) lets every device
 * verify a candidate passphrase locally before trusting it.
 */
export class EncryptionManager {
  private key: Buffer | null = null;
  private client: PgSyncClient;

  constructor(client: PgSyncClient) {
    this.client = client;
  }

  /** Whether a key has been derived and sentinel verified. */
  get initialized(): boolean {
    return this.key !== null;
  }

  /**
   * Initialize encryption for a passphrase.
   *
   * First-time setup (no salt in DB):
   *   1. Generate random salt
   *   2. Store salt in sync_metadata (key='encryption_salt')
   *   3. Derive AES key
   *   4. Create sentinel, store in sync_metadata (key='encryption_sentinel')
   *
   * Subsequent calls (salt exists):
   *   1. Read salt from sync_metadata
   *   2. Derive AES key
   *   3. Read sentinel from sync_metadata
   *   4. Verify sentinel — throw EncryptionError('WRONG_PASSPHRASE') if mismatch
   */
  async initialize(passphrase: string): Promise<void> {
    let saltHex = await this.client.getSyncMeta(SALT_META_KEY);

    if (!saltHex) {
      // First-time setup.
      const salt = generateSalt();
      saltHex = salt.toString('hex');
      await this.client.setSyncMeta(SALT_META_KEY, saltHex);

      const key = await deriveKey(passphrase, salt);
      const sentinel = createSentinel(key);
      await this.client.setSyncMeta(SENTINEL_META_KEY, sentinel);

      this.key = key;
      return;
    }

    // Existing setup — verify passphrase.
    const salt = Buffer.from(saltHex, 'hex');
    const key = await deriveKey(passphrase, salt);

    const sentinel = await this.client.getSyncMeta(SENTINEL_META_KEY);
    if (!sentinel || !verifySentinel(sentinel, key)) {
      throw new EncryptionError('Wrong passphrase — sentinel verification failed', 'WRONG_PASSPHRASE');
    }

    this.key = key;
  }

  /**
   * Encrypt a memory row's sensitive fields. Returns a new object — the
   * input row is never mutated. Skips fields that are null. Skips fields
   * that are already encrypted, to avoid double-encryption.
   *
   * Throws `EncryptionError` (DECRYPT_FAILED) if not initialized.
   */
  encryptRow(row: EncryptableRow): EncryptableRow {
    this.assertInitialized();
    const key = this.key!;

    return {
      content: isEncrypted(row.content) ? row.content : encryptField(row.content, key),
      summary: row.summary && !isEncrypted(row.summary) ? encryptField(row.summary, key) : row.summary,
      metadata: row.metadata && !isEncrypted(row.metadata) ? encryptField(row.metadata, key) : row.metadata,
      tags: row.tags && !isEncrypted(row.tags) ? encryptField(row.tags, key) : row.tags,
      embedding: row.embedding ? encryptEmbedding(row.embedding, key) : row.embedding,
    };
  }

  /**
   * Decrypt a memory row's sensitive fields. Returns a new object — the
   * input row is never mutated. Skips fields that are null or not
   * encrypted (so plaintext rows pass through unchanged).
   *
   * Throws `EncryptionError` (DECRYPT_FAILED) if not initialized, or if
   * decryption of any encrypted field fails (wrong key or tampered data).
   */
  decryptRow(row: EncryptableRow): EncryptableRow {
    this.assertInitialized();
    const key = this.key!;

    return {
      content: isEncrypted(row.content) ? decryptField(row.content, key) : row.content,
      summary: row.summary && isEncrypted(row.summary) ? decryptField(row.summary, key) : row.summary,
      metadata: row.metadata && isEncrypted(row.metadata) ? decryptField(row.metadata, key) : row.metadata,
      tags: row.tags && isEncrypted(row.tags) ? decryptField(row.tags, key) : row.tags,
      embedding: row.embedding ? decryptEmbedding(row.embedding, key) : row.embedding,
    };
  }

  /**
   * Like `decryptRow` but returns `null` instead of throwing on failure.
   * Used in the pull path to gracefully skip rows that can't be decrypted
   * (e.g. encrypted with a different passphrase) rather than aborting the
   * whole sync.
   */
  tryDecryptRow(row: EncryptableRow): EncryptableRow | null {
    try {
      return this.decryptRow(row);
    } catch {
      return null;
    }
  }

  /** Throw if not initialized. */
  private assertInitialized(): void {
    if (!this.key) {
      throw new EncryptionError('EncryptionManager not initialized — call initialize(passphrase) first', 'DECRYPT_FAILED');
    }
  }
}
