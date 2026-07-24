import { describe, it, expect } from 'vitest';
import {
  isPrivateAddress,
  assertSafeWebhookUrl,
  UnsafeWebhookUrlError,
  type HostResolver,
} from '../urlGuard.js';

/** Deterministic resolver so tests never touch the network. */
const resolveTo = (...addresses: string[]): HostResolver => async () => addresses;

describe('isPrivateAddress', () => {
  it('flags loopback, RFC1918, CGNAT and link-local IPv4', () => {
    for (const ip of [
      '127.0.0.1',
      '127.9.9.9',
      '10.0.0.1',
      '172.16.5.4',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '240.0.0.1',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '11.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('flags loopback, unique-local and link-local IPv6', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('flags IPv4-mapped IPv6 loopback', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('allows public IPv6', () => {
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });
});

describe('assertSafeWebhookUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'gopher://example.com']) {
      await expect(assertSafeWebhookUrl(url, { lookup: resolveTo('8.8.8.8') })).rejects.toBeInstanceOf(
        UnsafeWebhookUrlError,
      );
    }
  });

  it('rejects malformed URLs', async () => {
    await expect(assertSafeWebhookUrl('not a url')).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
  });

  it('rejects private IP literals without DNS', async () => {
    for (const url of [
      'http://127.0.0.1:9000/hook',
      'http://169.254.169.254/latest/meta-data/',
      'http://192.168.0.10/hook',
      'https://[::1]/hook',
    ]) {
      await expect(assertSafeWebhookUrl(url), url).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    }
  });

  it('rejects a public hostname that resolves to a private address (DNS rebinding)', async () => {
    await expect(
      assertSafeWebhookUrl('https://evil.example.com/hook', { lookup: resolveTo('127.0.0.1') }),
    ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
  });

  it('rejects when any resolved address is private', async () => {
    await expect(
      assertSafeWebhookUrl('https://mixed.example.com/hook', { lookup: resolveTo('8.8.8.8', '10.0.0.5') }),
    ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
  });

  it('accepts a public hostname resolving to public addresses', async () => {
    const url = await assertSafeWebhookUrl('https://hooks.example.com/x', {
      lookup: resolveTo('93.184.216.34'),
    });
    expect(url.hostname).toBe('hooks.example.com');
  });

  it('accepts public IP literals', async () => {
    const url = await assertSafeWebhookUrl('https://8.8.8.8/hook');
    expect(url.hostname).toBe('8.8.8.8');
  });

  it('allows private targets when explicitly opted in', async () => {
    const url = await assertSafeWebhookUrl('http://127.0.0.1:9000/hook', { allowPrivate: true });
    expect(url.port).toBe('9000');
  });

  it('rejects unresolvable hosts', async () => {
    const failing: HostResolver = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(
      assertSafeWebhookUrl('https://nope.invalid/hook', { lookup: failing }),
    ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
  });
});
