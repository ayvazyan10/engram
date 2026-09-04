/**
 * End-to-end encryption primitives for Engram cloud sync. Field values and
 * embedding vectors are encrypted client-side with a key derived from the
 * user's passphrase before they ever leave the device.
 *
 * This protects memory *content*, not the whole row: `namespace`,
 * `session_id`, `source`, `device_id`, `relationship` and every timestamp
 * stay plaintext because Postgres filters, cursors and resolves conflicts
 * on them. Anyone with access to the Postgres instance can therefore see how
 * many memories exist, when they changed, which device wrote them and how
 * they relate — just not what any of them say. `./syncCrypto.ts` has the
 * exact column list.
 *
 * Algorithm: AES-256-GCM with a random 12-byte nonce per encryption, a
 * 16-byte authentication tag, and associated data binding every ciphertext
 * to the row and column it belongs in (see `FieldBinding`). Keys are derived
 * from a passphrase with scrypt, a memory-hard KDF that resists
 * brute-forcing on commodity hardware/GPUs; the cost parameters are
 * recorded per database rather than hardcoded (see `ScryptParams`).
 *
 * See `.claude/PRPs/plans/postgres-cloud-sync.md` for the sync design this
 * module supports.
 */

import { randomBytes, scrypt, createCipheriv, createDecipheriv } from 'node:crypto';

/**
 * Version markers for encrypted string fields.
 *
 * `v1` is the original format: AES-256-GCM with no associated data, so a
 * ciphertext authenticated as "some value this key encrypted" and nothing
 * more. `v2` binds each ciphertext to its table, row id and column, which is
 * what stops a database operator cutting and pasting one row's `content`
 * into another row, or swapping `summary` and `content` inside one row —
 * every client would have decrypted and accepted either.
 *
 * v1 values are still read (see `decryptField`); nothing writes them.
 */
const FIELD_PREFIX_V1 = 'enc:v1:';
const FIELD_PREFIX_V2 = 'enc:v2:';

/** AES-256-GCM parameters. */
const CIPHER_ALGORITHM = 'aes-256-gcm';
const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ENVELOPE_OVERHEAD = NONCE_LENGTH + AUTH_TAG_LENGTH;

const SCRYPT_KEY_LENGTH = 32;

/** scrypt cost parameters. `N` is CPU/memory cost, `r` block size, `p` parallelization. */
export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/**
 * The cost a database bootstrapped today is built with. OWASP's minimum for
 * a passphrase-derived key is N=2^17, r=8, p=1; Engram shipped with N=2^15,
 * a quarter of it. Measured at roughly 320 ms on commodity hardware, and it
 * runs once per connection lifetime, not per sync cycle.
 */
export const SCRYPT_PARAMS_CURRENT: ScryptParams = { N: 131072, r: 8, p: 1 };

/**
 * What every database bootstrapped before the cost was recorded was built
 * with. A database that has a salt but no recorded parameters is one of
 * those, and MUST keep deriving at this cost — raising it there would
 * invalidate the stored sentinel and lock the owner out of every row already
 * encrypted under the old key. That failure mode (a database that can never
 * be opened again) is exactly what the bootstrap-atomicity fix eliminated.
 */
export const SCRYPT_PARAMS_LEGACY: ScryptParams = { N: 32768, r: 8, p: 1 };

/**
 * Bounds on parameters read back from the sync database.
 *
 * These arrive from the server, so they are attacker-controlled in the
 * threat model this module exists for. Without a floor, an operator could
 * publish `N=1024` and every client would obligingly derive a key cheap
 * enough to brute-force offline; without a ceiling, `N=2^30` is a
 * remote memory-exhaustion switch. The floor is the legacy cost, so the
 * worst a hostile server can do is hold a database at the security level it
 * already had.
 */
const SCRYPT_N_MIN = SCRYPT_PARAMS_LEGACY.N;
const SCRYPT_N_MAX = 1 << 22;
const SCRYPT_R_MAX = 32;
const SCRYPT_P_MAX = 16;

/** Fixed plaintext used to verify a passphrase without storing it. */
const SENTINEL_PLAINTEXT = 'engram-sentinel-v1';

/** Raised for any failure while encrypting or decrypting sync data. */
export class EncryptionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'DECRYPT_FAILED'
      | 'WRONG_PASSPHRASE'
      | 'MALFORMED_CIPHERTEXT'
      | 'BAD_KDF_PARAMS',
  ) {
    super(message);
    this.name = 'EncryptionError';
  }
}

// ─── associated data ────────────────────────────────────────────────────────

/**
 * What a ciphertext is allowed to be. Every `v2` value authenticates the
 * table, row id and column it was produced for, so moving it anywhere else
 * makes it fail to decrypt rather than silently decrypt into the wrong
 * place.
 *
 * NOT bound: `updated_at`, `archived_at`, `device_id` and the rest of the
 * plaintext metadata. Those are rewritten server-side by legitimate
 * operations that never touch content — `backfillNullDeviceIds` stamps
 * `device_id`, and the LWW upsert's `GREATEST` merge moves access
 * bookkeeping — so binding them would turn ordinary maintenance into a
 * permanently undecryptable row. They remain unauthenticated; see the
 * module docs in `./syncCrypto.ts` for what the server can still see and do.
 */
export interface FieldBinding {
  /** Logical table: `memories`, `sessions`, `memory_connections`. */
  table: string;
  /** Primary key of the row the value belongs to. */
  id: string;
  /** Database column name (snake_case) the value belongs in. */
  column: string;
}

/**
 * JSON rather than a delimiter-joined string: a row id or column name
 * containing the delimiter would otherwise let two different bindings
 * produce the same associated data, which is the exact confusion this is
 * meant to prevent.
 */
function associatedData(binding: FieldBinding): Buffer {
  return Buffer.from(
    JSON.stringify(['engram-aad-v2', binding.table, binding.id, binding.column]),
    'utf8',
  );
}

// ─── key derivation ─────────────────────────────────────────────────────────

/** Serialize KDF parameters for storage next to the salt. */
export function encodeScryptParams(params: ScryptParams): string {
  return JSON.stringify({ kdf: 'scrypt', N: params.N, r: params.r, p: params.p });
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

/**
 * Parse KDF parameters read back from the sync database, rejecting anything
 * outside the bounds above. Throws rather than falling back to a default:
 * silently substituting one cost for another is how a client ends up with a
 * key that does not match the sentinel it is about to verify against.
 */
export function decodeScryptParams(encoded: string): ScryptParams {
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new EncryptionError(`KDF parameters are not valid JSON: ${encoded}`, 'BAD_KDF_PARAMS');
  }

  const record = parsed as Record<string, unknown>;
  if (record?.['kdf'] !== 'scrypt') {
    throw new EncryptionError(
      `Unsupported key-derivation function "${String(record?.['kdf'])}" — this Engram only supports scrypt`,
      'BAD_KDF_PARAMS',
    );
  }

  const { N, r, p } = record as { N: unknown; r: unknown; p: unknown };
  const ok =
    typeof N === 'number' && typeof r === 'number' && typeof p === 'number' &&
    isPowerOfTwo(N) && N >= SCRYPT_N_MIN && N <= SCRYPT_N_MAX &&
    Number.isInteger(r) && r >= 1 && r <= SCRYPT_R_MAX &&
    Number.isInteger(p) && p >= 1 && p <= SCRYPT_P_MAX;

  if (!ok) {
    throw new EncryptionError(
      `KDF parameters out of the accepted range (N=${String(N)}, r=${String(r)}, p=${String(p)})`,
      'BAD_KDF_PARAMS',
    );
  }
  return { N, r, p };
}

/**
 * Derive a 32-byte AES-256 key from a passphrase and salt using scrypt.
 * Deterministic for a given (passphrase, salt, params) triple — the same
 * inputs always yield the same key, which is what lets every device
 * re-derive an identical key from a shared passphrase.
 */
export function deriveKey(
  passphrase: string,
  salt: Buffer,
  params: ScryptParams = SCRYPT_PARAMS_CURRENT,
): Promise<Buffer> {
  // scrypt needs maxmem >= ~128 * N * r bytes, which at the current cost is
  // 128 MiB — far past Node's 32 MiB default. Give it headroom so the
  // derivation never fails the memory check on a legitimate parameter set.
  const maxmem = 128 * params.N * params.r * 2;
  return new Promise((resolve, reject) => {
    scrypt(passphrase, salt, SCRYPT_KEY_LENGTH, { ...params, maxmem }, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(derivedKey);
    });
  });
}

/** Generate a fresh 32-byte random salt for `deriveKey`. */
export function generateSalt(): Buffer {
  return randomBytes(32);
}

// ─── string fields ──────────────────────────────────────────────────────────

/**
 * Encrypt a UTF-8 string field with AES-256-GCM, bound to `binding`.
 * Returns `enc:v2:<base64(nonce[12] || ciphertext || authTag[16])>`.
 */
export function encryptField(plaintext: string, key: Buffer, binding: FieldBinding): string {
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv(CIPHER_ALGORITHM, key, nonce);
  cipher.setAAD(associatedData(binding));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return FIELD_PREFIX_V2 + Buffer.concat([nonce, encrypted, authTag]).toString('base64');
}

/** Which encrypted-field format a value is in, if any. */
export type FieldVersion = 'v1' | 'v2';

/**
 * The envelope version of `value`, or null if it is not an envelope at all.
 * Callers need this to decrypt an embedding, which carries no marker of its
 * own and follows the version of the row's `content`.
 */
export function encryptedFieldVersion(value: string): FieldVersion | null {
  const prefix = value.startsWith(FIELD_PREFIX_V2)
    ? FIELD_PREFIX_V2
    : value.startsWith(FIELD_PREFIX_V1)
      ? FIELD_PREFIX_V1
      : null;
  if (prefix === null) return null;
  if (!isWellFormedPayload(value.slice(prefix.length))) return null;
  return prefix === FIELD_PREFIX_V2 ? 'v2' : 'v1';
}

/**
 * Whether `encoded` is base64 that decodes to at least a nonce and an auth
 * tag. `Buffer.from(x, 'base64')` silently discards characters outside the
 * alphabet, so the shape has to be checked before the length is trusted.
 */
function isWellFormedPayload(encoded: string): boolean {
  if (encoded.length === 0 || encoded.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return (encoded.length / 4) * 3 - padding >= ENVELOPE_OVERHEAD;
}

/**
 * Decrypt a string field produced by `encryptField`, or by the v1 format
 * that predates associated data.
 *
 * Throws `EncryptionError` (MALFORMED_CIPHERTEXT) if the value isn't a
 * well-formed envelope, and `EncryptionError` (DECRYPT_FAILED) if the key is
 * wrong, the ciphertext was tampered with, or a v2 value was moved to a
 * different row or column than the one it was encrypted for (GCM auth tag
 * mismatch in every case).
 */
export function decryptField(ciphertext: string, key: Buffer, binding: FieldBinding): string {
  const version = encryptedFieldVersion(ciphertext);
  if (version === null) {
    throw new EncryptionError(
      `Value is not a well-formed "${FIELD_PREFIX_V2}" or "${FIELD_PREFIX_V1}" envelope`,
      'MALFORMED_CIPHERTEXT',
    );
  }

  const prefixLength = version === 'v2' ? FIELD_PREFIX_V2.length : FIELD_PREFIX_V1.length;
  const raw = Buffer.from(ciphertext.slice(prefixLength), 'base64');
  // v1 predates associated data, so it must be opened without any — a v1
  // row written by an earlier version stays readable forever.
  const aad = version === 'v2' ? associatedData(binding) : null;

  return decryptEnvelope(raw, key, aad, 'field').toString('utf8');
}

/** Shared AES-256-GCM open for both the string and the embedding envelope. */
function decryptEnvelope(raw: Buffer, key: Buffer, aad: Buffer | null, label: string): Buffer {
  if (raw.length < ENVELOPE_OVERHEAD) {
    throw new EncryptionError(
      `Encrypted ${label} is too short to contain nonce and auth tag`,
      'MALFORMED_CIPHERTEXT',
    );
  }

  const nonce = raw.subarray(0, NONCE_LENGTH);
  const authTag = raw.subarray(raw.length - AUTH_TAG_LENGTH);
  const encrypted = raw.subarray(NONCE_LENGTH, raw.length - AUTH_TAG_LENGTH);

  try {
    const decipher = createDecipheriv(CIPHER_ALGORITHM, key, nonce);
    if (aad !== null) decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch (error: unknown) {
    throw new EncryptionError(
      `Failed to decrypt ${label}: ${error instanceof Error ? error.message : String(error)}`,
      'DECRYPT_FAILED',
    );
  }
}

/**
 * Whether a value is an encrypted field envelope produced by `encryptField`.
 *
 * Structural, not merely prefixed. A memory whose content literally started
 * with `enc:v1:` used to be mistaken for ciphertext: it was pushed to the
 * server in plaintext and then dropped on every pull because it failed to
 * decrypt — which also pinned the pull cursor, stalling sync for the whole
 * device. Requiring the remainder to be base64 that decodes to at least a
 * nonce plus an auth tag makes ordinary prose starting with the marker read
 * as what it is: prose.
 *
 * This is a heuristic; `isCiphertextFor` is the exact test, and is what the
 * encrypt path uses.
 */
export function isEncrypted(value: string): boolean {
  return encryptedFieldVersion(value) !== null;
}

/**
 * Whether `value` is ciphertext that `key` can actually open for exactly
 * this binding.
 *
 * Unlike `isEncrypted` this cannot be forged by user content: producing a
 * value that authenticates requires the key. The encrypt path uses it to
 * decide whether a field has already been encrypted, so a memory whose
 * content merely looks like an envelope is encrypted normally instead of
 * being shipped in the clear.
 */
export function isCiphertextFor(value: string, key: Buffer, binding: FieldBinding): boolean {
  if (!isEncrypted(value)) return false;
  try {
    decryptField(value, key, binding);
    return true;
  } catch {
    return false;
  }
}

// ─── embeddings ─────────────────────────────────────────────────────────────

/**
 * Encrypt raw embedding bytes with AES-256-GCM, bound to `binding`. Unlike
 * `encryptField` this has no version prefix or base64 wrapping — embeddings
 * are stored as raw bytes in the database, so the encrypted form stays a raw
 * byte buffer too, and its version is read off the row's `content` instead
 * (see `EncryptionManager.decryptRow`).
 * Returns `nonce[12] || ciphertext || authTag[16]`.
 */
export function encryptEmbedding(plainBuffer: Buffer, key: Buffer, binding: FieldBinding): Buffer {
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv(CIPHER_ALGORITHM, key, nonce);
  cipher.setAAD(associatedData(binding));
  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([nonce, encrypted, authTag]);
}

/**
 * Decrypt embedding bytes produced by `encryptEmbedding`.
 *
 * `binding` is null for a v1 row, whose embedding was encrypted before
 * associated data existed. Throws `EncryptionError` (MALFORMED_CIPHERTEXT)
 * if the buffer is too short to contain a nonce and auth tag, and
 * (DECRYPT_FAILED) if the key is wrong, the data was tampered with, or the
 * bytes came from a different row.
 */
export function decryptEmbedding(
  encryptedBuffer: Buffer,
  key: Buffer,
  binding: FieldBinding | null,
): Buffer {
  const aad = binding === null ? null : associatedData(binding);
  return decryptEnvelope(encryptedBuffer, key, aad, 'embedding');
}

// ─── sentinel ───────────────────────────────────────────────────────────────

/**
 * The sentinel is a value of the `sync_metadata` row that holds it, so it
 * gets the same binding treatment as any other encrypted column.
 */
const SENTINEL_BINDING: FieldBinding = {
  table: 'sync_metadata',
  id: 'encryption_sentinel',
  column: 'value',
};

/**
 * Encrypt the fixed sentinel plaintext under `key`. Stored alongside the
 * salt so any device can verify a candidate passphrase locally, without a
 * network round-trip and without ever storing the passphrase itself.
 */
export function createSentinel(key: Buffer): string {
  return encryptField(SENTINEL_PLAINTEXT, key, SENTINEL_BINDING);
}

/**
 * Verify a candidate key against a stored sentinel. Returns `true` only if
 * decryption succeeds and yields the expected sentinel plaintext — any
 * decryption failure (wrong key, tampered/malformed sentinel) yields
 * `false` rather than throwing. A sentinel written in the v1 format is
 * verified in that format; see `decryptField`.
 */
export function verifySentinel(sentinel: string, key: Buffer): boolean {
  try {
    return decryptField(sentinel, key, SENTINEL_BINDING) === SENTINEL_PLAINTEXT;
  } catch {
    return false;
  }
}
