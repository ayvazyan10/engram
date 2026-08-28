/**
 * End-to-end encryption primitives for Engram cloud sync. Field values and
 * embedding vectors are encrypted client-side with a key derived from the
 * user's passphrase before they ever leave the device — the sync server
 * (and anyone with access to the Postgres instance) only ever sees
 * ciphertext.
 *
 * Algorithm: AES-256-GCM with a random 12-byte nonce per encryption and a
 * 16-byte authentication tag, giving both confidentiality and integrity
 * (tamper detection). Keys are derived from a passphrase with scrypt
 * (N=2^15, r=8, p=1), a memory-hard KDF that resists brute-forcing on
 * commodity hardware/GPUs.
 *
 * See `.claude/PRPs/plans/postgres-cloud-sync.md` for the sync design this
 * module supports.
 */

import { randomBytes, scrypt, createCipheriv, createDecipheriv } from 'node:crypto';

/** Version prefix for encrypted string fields — see `encryptField`. */
const ENCRYPTED_FIELD_PREFIX = 'enc:v1:';

/** AES-256-GCM parameters. */
const CIPHER_ALGORITHM = 'aes-256-gcm';
const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/** scrypt KDF parameters: N=2^15 (CPU/memory cost), r=8 (block size), p=1 (parallelization). */
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;
// scrypt requires maxmem >= ~128 * N * r bytes for these parameters (roughly
// 32 MiB here), which sits right at Node's 32 MiB default — give it
// generous headroom so the derivation never fails on the memory check.
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2;

/** Fixed plaintext used to verify a passphrase without storing it. */
const SENTINEL_PLAINTEXT = 'engram-sentinel-v1';

/** Raised for any failure while encrypting or decrypting sync data. */
export class EncryptionError extends Error {
  constructor(
    message: string,
    public readonly code: 'DECRYPT_FAILED' | 'WRONG_PASSPHRASE' | 'MALFORMED_CIPHERTEXT',
  ) {
    super(message);
    this.name = 'EncryptionError';
  }
}

/**
 * Derive a 32-byte AES-256 key from a passphrase and salt using scrypt.
 * Deterministic for a given (passphrase, salt) pair — the same inputs
 * always yield the same key, which is what lets every device re-derive an
 * identical key from a shared passphrase.
 */
export async function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      passphrase,
      salt,
      SCRYPT_KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM },
      (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

/**
 * Encrypt a UTF-8 string field with AES-256-GCM.
 * Returns `enc:v1:<base64(nonce[12] || ciphertext || authTag[16])>`.
 */
export function encryptField(plaintext: string, key: Buffer): string {
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv(CIPHER_ALGORITHM, key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return ENCRYPTED_FIELD_PREFIX + Buffer.concat([nonce, encrypted, authTag]).toString('base64');
}

/**
 * Decrypt a string field produced by `encryptField`.
 * Throws `EncryptionError` (MALFORMED_CIPHERTEXT) if the value doesn't have
 * the expected `enc:v1:` prefix or can't be parsed, and `EncryptionError`
 * (DECRYPT_FAILED) if the key is wrong or the ciphertext was tampered with
 * (GCM auth tag mismatch).
 */
export function decryptField(ciphertext: string, key: Buffer): string {
  if (!ciphertext.startsWith(ENCRYPTED_FIELD_PREFIX)) {
    throw new EncryptionError(
      `Ciphertext is missing the expected "${ENCRYPTED_FIELD_PREFIX}" prefix`,
      'MALFORMED_CIPHERTEXT',
    );
  }

  const encoded = ciphertext.slice(ENCRYPTED_FIELD_PREFIX.length);
  let raw: Buffer;
  try {
    raw = Buffer.from(encoded, 'base64');
  } catch {
    throw new EncryptionError('Ciphertext is not valid base64', 'MALFORMED_CIPHERTEXT');
  }

  if (raw.length < NONCE_LENGTH + AUTH_TAG_LENGTH) {
    throw new EncryptionError('Ciphertext is too short to contain nonce and auth tag', 'MALFORMED_CIPHERTEXT');
  }

  const nonce = raw.subarray(0, NONCE_LENGTH);
  const authTag = raw.subarray(raw.length - AUTH_TAG_LENGTH);
  const encrypted = raw.subarray(NONCE_LENGTH, raw.length - AUTH_TAG_LENGTH);

  try {
    const decipher = createDecipheriv(CIPHER_ALGORITHM, key, nonce);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (error: unknown) {
    throw new EncryptionError(
      `Failed to decrypt field: ${error instanceof Error ? error.message : String(error)}`,
      'DECRYPT_FAILED',
    );
  }
}

/** Check whether a value is an encrypted field produced by `encryptField`. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_FIELD_PREFIX);
}

/**
 * Encrypt raw embedding bytes with AES-256-GCM. Unlike `encryptField`, this
 * has no version prefix or base64 wrapping — embeddings are stored as raw
 * bytes in the database, so the encrypted form stays a raw byte buffer too.
 * Returns `nonce[12] || ciphertext || authTag[16]`.
 */
export function encryptEmbedding(plainBuffer: Buffer, key: Buffer): Buffer {
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv(CIPHER_ALGORITHM, key, nonce);
  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([nonce, encrypted, authTag]);
}

/**
 * Decrypt embedding bytes produced by `encryptEmbedding`.
 * Throws `EncryptionError` (MALFORMED_CIPHERTEXT) if the buffer is too
 * short to contain a nonce and auth tag, and `EncryptionError`
 * (DECRYPT_FAILED) if the key is wrong or the data was tampered with.
 */
export function decryptEmbedding(encryptedBuffer: Buffer, key: Buffer): Buffer {
  if (encryptedBuffer.length < NONCE_LENGTH + AUTH_TAG_LENGTH) {
    throw new EncryptionError(
      'Encrypted embedding buffer is too short to contain nonce and auth tag',
      'MALFORMED_CIPHERTEXT',
    );
  }

  const nonce = encryptedBuffer.subarray(0, NONCE_LENGTH);
  const authTag = encryptedBuffer.subarray(encryptedBuffer.length - AUTH_TAG_LENGTH);
  const encrypted = encryptedBuffer.subarray(NONCE_LENGTH, encryptedBuffer.length - AUTH_TAG_LENGTH);

  try {
    const decipher = createDecipheriv(CIPHER_ALGORITHM, key, nonce);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch (error: unknown) {
    throw new EncryptionError(
      `Failed to decrypt embedding: ${error instanceof Error ? error.message : String(error)}`,
      'DECRYPT_FAILED',
    );
  }
}

/** Generate a fresh 32-byte random salt for `deriveKey`. */
export function generateSalt(): Buffer {
  return randomBytes(32);
}

/**
 * Encrypt the fixed sentinel plaintext under `key`. Stored alongside the
 * salt so any device can verify a candidate passphrase locally, without a
 * network round-trip and without ever storing the passphrase itself.
 */
export function createSentinel(key: Buffer): string {
  return encryptField(SENTINEL_PLAINTEXT, key);
}

/**
 * Verify a candidate key against a stored sentinel. Returns `true` only if
 * decryption succeeds and yields the expected sentinel plaintext — any
 * decryption failure (wrong key, tampered/malformed sentinel) yields
 * `false` rather than throwing.
 */
export function verifySentinel(sentinel: string, key: Buffer): boolean {
  try {
    return decryptField(sentinel, key) === SENTINEL_PLAINTEXT;
  } catch {
    return false;
  }
}
