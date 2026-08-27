/**
 * Unit tests for the Postgres sync connection helpers. No database
 * involved — these only exercise `validateSyncUrl` and the password
 * redaction helper.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { validateSyncUrl, redactSyncUrl } from '../connection.js';

const ORIGINAL_ALLOW_UNENCRYPTED = process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'];

afterEach(() => {
  if (ORIGINAL_ALLOW_UNENCRYPTED === undefined) {
    delete process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'];
  } else {
    process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'] = ORIGINAL_ALLOW_UNENCRYPTED;
  }
});

describe('validateSyncUrl', () => {
  it('rejects an empty URL', () => {
    expect(() => validateSyncUrl('')).toThrow(/missing or empty/i);
  });

  it('rejects a whitespace-only URL', () => {
    expect(() => validateSyncUrl('   ')).toThrow(/missing or empty/i);
  });

  it('rejects a URL that is not a valid URL at all', () => {
    delete process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'];
    expect(() => validateSyncUrl('not a url')).toThrow(/not a valid URL/i);
  });

  it('rejects a non-postgres scheme', () => {
    expect(() =>
      validateSyncUrl('mysql://user:pass@host:3306/db?sslmode=require')
    ).toThrow(/postgres:\/\/ or postgresql:\/\//i);
  });

  it('rejects a URL without sslmode when ENGRAM_SYNC_ALLOW_UNENCRYPTED is not set', () => {
    delete process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'];
    expect(() =>
      validateSyncUrl('postgres://user:pass@host:5432/db')
    ).toThrow(/must require TLS/i);
  });

  it('rejects sslmode values other than "require" by default', () => {
    delete process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'];
    expect(() =>
      validateSyncUrl('postgres://user:pass@host:5432/db?sslmode=prefer')
    ).toThrow(/must require TLS/i);
  });

  it('accepts a URL with sslmode=require', () => {
    delete process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'];
    expect(() =>
      validateSyncUrl('postgres://user:pass@host:5432/db?sslmode=require')
    ).not.toThrow();
  });

  it('accepts the postgresql:// scheme too', () => {
    expect(() =>
      validateSyncUrl('postgresql://user:pass@host:5432/db?sslmode=require')
    ).not.toThrow();
  });

  it('accepts a URL without sslmode when ENGRAM_SYNC_ALLOW_UNENCRYPTED=true', () => {
    process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'] = 'true';
    expect(() =>
      validateSyncUrl('postgres://user:pass@host:5432/db')
    ).not.toThrow();
  });

  it('never includes the raw password in a thrown error message', () => {
    delete process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'];
    try {
      validateSyncUrl('postgres://myuser:sup3rSecret@host:5432/db');
      throw new Error('expected validateSyncUrl to throw');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain('sup3rSecret');
    }
  });

  it('handles various valid postgres:// connection string shapes', () => {
    const urls = [
      'postgres://user:pass@ep-xxx.neon.tech/engram?sslmode=require',
      'postgresql://user:pass@localhost:5432/engram?sslmode=require&application_name=engram',
      'postgres://user@host/engram?sslmode=require',
      'postgres://user:pass@host:6543/postgres?sslmode=require&pgbouncer=true',
    ];
    for (const url of urls) {
      expect(() => validateSyncUrl(url)).not.toThrow();
    }
  });
});

describe('redactSyncUrl', () => {
  it('replaces the password with a placeholder', () => {
    const redacted = redactSyncUrl('postgres://myuser:sup3rSecret@host:5432/db?sslmode=require');
    expect(redacted).not.toContain('sup3rSecret');
    expect(redacted).toContain('myuser');
    expect(redacted).toContain('***');
  });

  it('leaves a URL without a password unchanged in substance', () => {
    const redacted = redactSyncUrl('postgres://myuser@host:5432/db?sslmode=require');
    expect(redacted).toContain('myuser');
    expect(redacted).toContain('host:5432');
  });

  it('never returns the raw input for an unparseable string', () => {
    const raw = 'not a url with password=hunter2';
    const redacted = redactSyncUrl(raw);
    expect(redacted).not.toBe(raw);
    expect(redacted).not.toContain('hunter2');
  });

  it('preserves the rest of the connection string (host, db, query)', () => {
    const redacted = redactSyncUrl(
      'postgres://myuser:sup3rSecret@ep-xxx.neon.tech:5432/engram?sslmode=require'
    );
    expect(redacted).toContain('ep-xxx.neon.tech');
    expect(redacted).toContain('5432');
    expect(redacted).toContain('engram');
    expect(redacted).toContain('sslmode=require');
  });
});
