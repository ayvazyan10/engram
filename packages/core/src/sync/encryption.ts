/**
 * EncryptionManager wires the E2E encryption primitives in `./crypto.ts` to
 * a `PgSyncClient` for salt/parameter/sentinel persistence, and exposes a
 * small row-level API (`encryptRow` / `decryptRow` and their
 * session/connection counterparts) that the sync push/pull paths use to
 * encrypt user content before it leaves the device and decrypt it after it
 * arrives.
 *
 * What is and isn't encrypted is deliberate — see `EncryptableRow` below.
 *
 * Every ciphertext is bound to the table, row id and column it belongs in
 * (`FieldBinding` in `./crypto.ts`), which is why every method here takes a
 * row that carries its own `id`. Without that binding a database operator
 * could move one row's `content` into another row, or swap `summary` and
 * `content`, and every client would decrypt and accept the result.
 *
 * See `.claude/PRPs/plans/postgres-cloud-sync.md` for the sync design this
 * module supports.
 */

import {
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
  EncryptionError,
  SCRYPT_PARAMS_CURRENT,
  SCRYPT_PARAMS_LEGACY,
  type FieldBinding,
} from './crypto.js';
import type { PgSyncClient } from './PgSyncClient.js';

/** Logical table names used as the first component of every binding. */
const TABLE_MEMORIES = 'memories';
const TABLE_SESSIONS = 'sessions';
const TABLE_CONNECTIONS = 'memory_connections';

/**
 * The `memories` fields that get encrypted before push.
 *
 * These are exactly the user-content columns. `namespace`, `session_id`,
 * `source`, `device_id`, `type` and every timestamp are deliberately NOT
 * here: the server filters, cursors and resolves conflicts on them, so
 * encrypting them would break sync itself. `concept` / `trigger_pattern` /
 * `action_pattern` ARE here — they hold the actual content of semantic and
 * procedural memories, and nothing server-side reads them.
 *
 * `id` is not encrypted either, but it is required: it is what each field's
 * ciphertext is bound to.
 */
export interface EncryptableRow {
  id: string;
  content: string;
  summary: string | null;
  metadata: string | null; // JSON string
  tags: string | null; // JSON string
  embedding: Buffer | null;
  concept: string | null;
  triggerPattern: string | null;
  actionPattern: string | null;
}

/** The `sessions` fields that get encrypted. `source`/`namespace` stay plaintext (filtered on). */
export interface EncryptableSession {
  id: string;
  context: string | null; // free-form JSON
}

/** The `memory_connections` fields that get encrypted. `relationship` stays plaintext (a filterable type). */
export interface EncryptableConnection {
  id: string;
  metadata: string | null; // JSON string
}

/** Column names, as they appear in the database, for binding purposes. */
const MEMORY_COLUMNS = {
  content: 'content',
  summary: 'summary',
  metadata: 'metadata',
  tags: 'tags',
  embedding: 'embedding',
  concept: 'concept',
  triggerPattern: 'trigger_pattern',
  actionPattern: 'action_pattern',
} as const;

/**
 * Derives and holds the AES-256 key used to encrypt/decrypt synced rows,
 * deriving it from a user passphrase and a salt persisted in Postgres via
 * `PgSyncClient`. A sentinel value (also persisted) lets every device verify
 * a candidate passphrase locally before trusting it.
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
   * Setup and verification are the same code path, driven by
   * `PgSyncClient.bootstrapEncryptionMeta`, which commits the salt, the KDF
   * parameters and the sentinel first-wins inside one transaction:
   *
   *   1. Offer a fresh random salt; get back whichever salt is established.
   *   2. Offer KDF parameters; get back whichever are established. A
   *      database that already had a salt but no recorded parameters was
   *      bootstrapped before they were recorded, so it gets the legacy cost.
   *   3. Derive the AES key from *those* (inside the transaction).
   *   4. Offer a sentinel for it; get back whichever sentinel is established.
   *   5. Verify — throw `EncryptionError('WRONG_PASSPHRASE')` on mismatch.
   *
   * Branching on "is there a salt yet?" here is what made concurrent and
   * interrupted bootstraps unrecoverable (see `bootstrapEncryptionMeta`);
   * offering-and-verifying unconditionally has no such state to get wrong,
   * and repairs a half-finished bootstrap on the way through.
   */
  async initialize(passphrase: string): Promise<void> {
    let derivedKey: Buffer | null = null;

    const established = await this.client.bootstrapEncryptionMeta({
      candidateSaltHex: generateSalt().toString('hex'),
      freshKdfParams: encodeScryptParams(SCRYPT_PARAMS_CURRENT),
      legacyKdfParams: encodeScryptParams(SCRYPT_PARAMS_LEGACY),
      deriveSentinel: async (saltHex: string, kdfParams: string) => {
        const key = await deriveKey(
          passphrase,
          Buffer.from(saltHex, 'hex'),
          decodeScryptParams(kdfParams),
        );
        derivedKey = key;
        return createSentinel(key);
      },
    });

    // Defensive: a client implementation that never invoked the callback
    // would otherwise leave us "initialized" with no key at all.
    const key: Buffer | null = derivedKey;
    if (key === null) {
      throw new EncryptionError(
        'Encryption bootstrap returned without deriving a key',
        'DECRYPT_FAILED',
      );
    }

    if (verifySentinel(established.sentinel, key)) {
      this.key = key;
      return;
    }

    await this.recoverFromKdfSkew(passphrase, established);
  }

  /**
   * Last resort before declaring the passphrase wrong: re-derive at the
   * legacy cost and see whether the sentinel matches that instead.
   *
   * The recorded parameters and the sentinel can disagree in exactly one
   * situation — an old client (which knows nothing about the KDF metadata)
   * bootstrapping the same fresh database concurrently with a new one, so
   * the sentinel lands at the legacy cost while the parameter row says
   * otherwise. Without this, that database could never be opened by anyone
   * again, which is precisely the outcome the bootstrap work set out to make
   * impossible. The extra derivation only ever runs on the failure path.
   *
   * On success the parameter row is corrected, so no later device pays for
   * a derivation it is going to throw away.
   */
  private async recoverFromKdfSkew(
    passphrase: string,
    established: { saltHex: string; kdfParams: string; sentinel: string },
  ): Promise<void> {
    const legacyParams = encodeScryptParams(SCRYPT_PARAMS_LEGACY);
    if (established.kdfParams !== legacyParams) {
      const legacyKey = await deriveKey(
        passphrase,
        Buffer.from(established.saltHex, 'hex'),
        SCRYPT_PARAMS_LEGACY,
      );
      if (verifySentinel(established.sentinel, legacyKey)) {
        console.warn(
          '[engram] Sync database records newer key-derivation parameters than its sentinel was ' +
            'built with; falling back to the original cost and correcting the record.',
        );
        await this.client.setEncryptionKdfParams(legacyParams);
        this.key = legacyKey;
        return;
      }
    }

    throw new EncryptionError('Wrong passphrase — sentinel verification failed', 'WRONG_PASSPHRASE');
  }

  /**
   * Encrypt a memory row's user-content fields. Returns a new object — the
   * input row is never mutated. Skips fields that are null.
   *
   * "Already encrypted" is decided by opening the value under our own key
   * and binding, not by looking for the marker prefix: content that merely
   * *starts* with `enc:v1:` is ordinary text, and treating it as ciphertext
   * shipped it to the server in the clear.
   *
   * Throws `EncryptionError` (DECRYPT_FAILED) if not initialized.
   */
  encryptRow(row: EncryptableRow): EncryptableRow {
    const key = this.requireKey();
    const bind = (column: string): FieldBinding => ({ table: TABLE_MEMORIES, id: row.id, column });
    const field = (value: string | null, column: string): string | null =>
      value !== null && !isCiphertextFor(value, key, bind(column))
        ? encryptField(value, key, bind(column))
        : value;

    const contentEncrypted = isCiphertextFor(row.content, key, bind(MEMORY_COLUMNS.content));

    return {
      id: row.id,
      content: contentEncrypted ? row.content : encryptField(row.content, key, bind(MEMORY_COLUMNS.content)),
      summary: field(row.summary, MEMORY_COLUMNS.summary),
      metadata: field(row.metadata, MEMORY_COLUMNS.metadata),
      tags: field(row.tags, MEMORY_COLUMNS.tags),
      // Embeddings carry no marker (they stay raw bytes), so whether this
      // row is already encrypted has to be read off `content`, which is NOT
      // NULL and therefore always present.
      embedding:
        row.embedding && !contentEncrypted
          ? encryptEmbedding(row.embedding, key, bind(MEMORY_COLUMNS.embedding))
          : row.embedding,
      concept: field(row.concept, MEMORY_COLUMNS.concept),
      triggerPattern: field(row.triggerPattern, MEMORY_COLUMNS.triggerPattern),
      actionPattern: field(row.actionPattern, MEMORY_COLUMNS.actionPattern),
    };
  }

  /**
   * Decrypt a memory row's user-content fields. Returns a new object — the
   * input row is never mutated.
   *
   * Every string field is gated on being a well-formed envelope, so a row
   * that was pushed in plaintext (by a client running without a passphrase,
   * or from before encryption existed) passes through untouched rather than
   * failing GCM and being dropped. The embedding has no marker of its own,
   * so it follows `content`: encrypted row ⇒ encrypted embedding, and the
   * row's format version decides whether its embedding was bound to the row
   * or predates binding.
   *
   * Throws `EncryptionError` (DECRYPT_FAILED) if not initialized, or if
   * decryption of an actually-encrypted field fails (wrong key, tampered
   * data, or a value moved from another row or column).
   */
  decryptRow(row: EncryptableRow): EncryptableRow {
    const key = this.requireKey();
    const bind = (column: string): FieldBinding => ({ table: TABLE_MEMORIES, id: row.id, column });
    const field = (value: string | null, column: string): string | null =>
      value !== null && isEncrypted(value) ? decryptField(value, key, bind(column)) : value;

    const version = encryptedFieldVersion(row.content);

    return {
      id: row.id,
      content: version === null ? row.content : decryptField(row.content, key, bind(MEMORY_COLUMNS.content)),
      summary: field(row.summary, MEMORY_COLUMNS.summary),
      metadata: field(row.metadata, MEMORY_COLUMNS.metadata),
      tags: field(row.tags, MEMORY_COLUMNS.tags),
      embedding:
        row.embedding && version !== null
          ? decryptEmbedding(
              row.embedding,
              key,
              version === 'v2' ? bind(MEMORY_COLUMNS.embedding) : null,
            )
          : row.embedding,
      concept: field(row.concept, MEMORY_COLUMNS.concept),
      triggerPattern: field(row.triggerPattern, MEMORY_COLUMNS.triggerPattern),
      actionPattern: field(row.actionPattern, MEMORY_COLUMNS.actionPattern),
    };
  }

  /** Encrypt a session row's `context`. New object; nulls and ciphertext pass through. */
  encryptSession(row: EncryptableSession): EncryptableSession {
    const key = this.requireKey();
    const binding: FieldBinding = { table: TABLE_SESSIONS, id: row.id, column: 'context' };
    return {
      id: row.id,
      context:
        row.context !== null && !isCiphertextFor(row.context, key, binding)
          ? encryptField(row.context, key, binding)
          : row.context,
    };
  }

  /** Decrypt a session row's `context`. Plaintext (legacy) values pass through. */
  decryptSession(row: EncryptableSession): EncryptableSession {
    const key = this.requireKey();
    const binding: FieldBinding = { table: TABLE_SESSIONS, id: row.id, column: 'context' };
    return {
      id: row.id,
      context:
        row.context !== null && isEncrypted(row.context)
          ? decryptField(row.context, key, binding)
          : row.context,
    };
  }

  /** Encrypt a connection row's `metadata`. New object; nulls and ciphertext pass through. */
  encryptConnection(row: EncryptableConnection): EncryptableConnection {
    const key = this.requireKey();
    const binding: FieldBinding = { table: TABLE_CONNECTIONS, id: row.id, column: 'metadata' };
    return {
      id: row.id,
      metadata:
        row.metadata !== null && !isCiphertextFor(row.metadata, key, binding)
          ? encryptField(row.metadata, key, binding)
          : row.metadata,
    };
  }

  /** Decrypt a connection row's `metadata`. Plaintext (legacy) values pass through. */
  decryptConnection(row: EncryptableConnection): EncryptableConnection {
    const key = this.requireKey();
    const binding: FieldBinding = { table: TABLE_CONNECTIONS, id: row.id, column: 'metadata' };
    return {
      id: row.id,
      metadata:
        row.metadata !== null && isEncrypted(row.metadata)
          ? decryptField(row.metadata, key, binding)
          : row.metadata,
    };
  }

  /**
   * Like `decryptRow` but returns `null` instead of throwing on failure.
   * Used in the pull path to isolate rows that can't be decrypted (e.g.
   * encrypted under a different passphrase, or moved between rows by the
   * server) rather than aborting the whole sync — see `./syncCrypto.ts` for
   * what the caller does with the `null`.
   */
  tryDecryptRow(row: EncryptableRow): EncryptableRow | null {
    return tryOrNull(() => this.decryptRow(row));
  }

  /** `decryptSession`, returning `null` instead of throwing. */
  tryDecryptSession(row: EncryptableSession): EncryptableSession | null {
    return tryOrNull(() => this.decryptSession(row));
  }

  /** `decryptConnection`, returning `null` instead of throwing. */
  tryDecryptConnection(row: EncryptableConnection): EncryptableConnection | null {
    return tryOrNull(() => this.decryptConnection(row));
  }

  /** The derived key, or throw if `initialize()` hasn't run. */
  private requireKey(): Buffer {
    if (!this.key) {
      throw new EncryptionError('EncryptionManager not initialized — call initialize(passphrase) first', 'DECRYPT_FAILED');
    }
    return this.key;
  }
}

function tryOrNull<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
