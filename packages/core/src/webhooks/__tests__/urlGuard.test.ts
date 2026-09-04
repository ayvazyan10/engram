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
    // The hex spelling is the one `new URL()` actually produces — the dotted
    // form alone left the real attack path untested.
    expect(isPrivateAddress('::ffff:7f00:1')).toBe(true);
    expect(isPrivateAddress('::ffff:808:808')).toBe(false);
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

// ─── IPv6 spelling normalisation (V1 regression) ─────────────────────────────

/**
 * The same address, written two ways. `new URL()` always re-serialises an IPv6
 * host in compressed hex, so the `hex` column is what the guard is actually
 * handed at delivery time; the `dotted` column is the only one the original
 * guard could recognise.
 */
const MAPPING_SPELLINGS: ReadonlyArray<{
  readonly dotted: string;
  readonly hex: string;
  readonly private: boolean;
  readonly why: string;
}> = [
  // ::ffff:0:0/96 — IPv4-mapped
  { dotted: '::ffff:127.0.0.1', hex: '::ffff:7f00:1', private: true, why: 'loopback' },
  { dotted: '::ffff:169.254.169.254', hex: '::ffff:a9fe:a9fe', private: true, why: 'cloud metadata' },
  { dotted: '::ffff:10.0.0.1', hex: '::ffff:a00:1', private: true, why: 'RFC1918 10/8' },
  { dotted: '::ffff:172.16.5.4', hex: '::ffff:ac10:504', private: true, why: 'RFC1918 172.16/12' },
  { dotted: '::ffff:192.168.1.1', hex: '::ffff:c0a8:101', private: true, why: 'RFC1918 192.168/16' },
  { dotted: '::ffff:100.64.0.1', hex: '::ffff:6440:1', private: true, why: 'CGNAT' },
  { dotted: '::ffff:0.0.0.0', hex: '::ffff:0:0', private: true, why: 'unspecified' },
  { dotted: '::ffff:224.0.0.1', hex: '::ffff:e000:1', private: true, why: 'multicast' },
  { dotted: '::ffff:240.0.0.1', hex: '::ffff:f000:1', private: true, why: 'reserved' },
  { dotted: '::ffff:8.8.8.8', hex: '::ffff:808:808', private: false, why: 'public' },
  { dotted: '::ffff:93.184.216.34', hex: '::ffff:5db8:d822', private: false, why: 'public' },

  // ::ffff:0:0:0/96 — IPv4-translated (RFC 2765)
  { dotted: '::ffff:0:127.0.0.1', hex: '::ffff:0:7f00:1', private: true, why: 'translated loopback' },
  { dotted: '::ffff:0:8.8.8.8', hex: '::ffff:0:808:808', private: false, why: 'translated public' },

  // 64:ff9b::/96 — NAT64 (RFC 6052)
  { dotted: '64:ff9b::127.0.0.1', hex: '64:ff9b::7f00:1', private: true, why: 'NAT64 loopback' },
  { dotted: '64:ff9b::169.254.169.254', hex: '64:ff9b::a9fe:a9fe', private: true, why: 'NAT64 metadata' },
  { dotted: '64:ff9b::192.168.1.1', hex: '64:ff9b::c0a8:101', private: true, why: 'NAT64 RFC1918' },
  { dotted: '64:ff9b::8.8.8.8', hex: '64:ff9b::808:808', private: false, why: 'NAT64 public' },
];

/** 6to4 embeds its IPv4 in bits 16..48, so there is no dotted spelling. */
const SIX_TO_FOUR: ReadonlyArray<readonly [string, boolean]> = [
  ['2002:7f00:1::1', true],       // 127.0.0.1
  ['2002:a9fe:a9fe::1', true],    // 169.254.169.254
  ['2002:c0a8:101::1', true],     // 192.168.1.1
  ['2002:a00:1::1', true],        // 10.0.0.1
  ['2002:808:808::1', false],     // 8.8.8.8
];

describe('isPrivateAddress — IPv6 spelling normalisation', () => {
  it('classifies dotted and hex spellings of a mapping identically', () => {
    for (const c of MAPPING_SPELLINGS) {
      expect(isPrivateAddress(c.dotted), `${c.dotted} (${c.why})`).toBe(c.private);
      expect(isPrivateAddress(c.hex), `${c.hex} (${c.why})`).toBe(c.private);
    }
  });

  it('classifies the hex form that `new URL()` actually produces', () => {
    for (const c of MAPPING_SPELLINGS) {
      const hostname = new URL(`http://[${c.dotted}]/`).hostname.replace(/^\[|\]$/g, '');
      expect(hostname, `${c.dotted} serialises to ${hostname}`).toBe(c.hex);
      expect(isPrivateAddress(hostname), hostname).toBe(c.private);
    }
  });

  it('classifies 6to4 on its embedded IPv4', () => {
    for (const [address, isPrivate] of SIX_TO_FOUR) {
      expect(isPrivateAddress(address), address).toBe(isPrivate);
    }
  });

  it('flags IPv6 special-purpose ranges in every spelling', () => {
    for (const ip of [
      '::',                       // unspecified
      '0:0:0:0:0:0:0:0',          // ...uncompressed
      '::1',                      // loopback
      '0:0:0:0:0:0:0:1',          // ...uncompressed
      '::13.1.68.3',              // deprecated IPv4-compatible
      '::d01:4403',               // ...as `new URL()` serialises it
      'fc00::1',
      'fd12:3456::1',
      'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      'fe80::1',
      'febf::1',                  // top of fe80::/10
      'fe80::1%eth0',             // zone id must not defeat classification
      'ff02::1',
      'ff00::',
      '100::1',                   // discard-only prefix
      '64:ff9b:1::1',             // local-use NAT64
      '2001::1',                  // Teredo (2001::/23)
      '2001:2::1',                // benchmarking
      '2001:20::1',               // ORCHIDv2
      '2001:db8::1',              // documentation
      '3fff::1',                  // documentation (RFC 9637)
      '4000::1',                  // outside 2000::/3 — not global unicast
      'c000::1',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('still allows genuine global unicast IPv6', () => {
    for (const ip of [
      '2606:4700:4700::1111',
      '2a00:1450:4001:80f::200e',
      '2001:4860:4860::8888',  // 2001:4860/32 is a real allocation, not 2001::/23
      '3ffe::1',               // 3ffe::/16 is ordinary global unicast — the
                               // 3fff::/20 documentation carve-out must not swallow it
      '3fff:1000::1',          // ...and neither must it swallow the rest of 3fff::/16
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('fails closed on anything that is not a parseable IP address', () => {
    for (const value of ['', '   ', 'example.com', '127.0.0', '::ffff:999.1.1.1', 'not-an-ip', '::gggg']) {
      expect(isPrivateAddress(value), JSON.stringify(value)).toBe(true);
    }
  });
});

describe('assertSafeWebhookUrl — IPv6 literals through the URL parser', () => {
  it('rejects private targets written as IPv6 literals', async () => {
    const urls = [
      'http://[::ffff:127.0.0.1]:9000/hook',
      'http://[::ffff:7f00:1]:9000/hook',
      'http://[::ffff:169.254.169.254]/latest/meta-data/',
      'http://[::ffff:a9fe:a9fe]/latest/meta-data/',
      'http://[::ffff:0:127.0.0.1]/hook',
      'http://[64:ff9b::7f00:1]/',
      'http://[64:ff9b::127.0.0.1]/',
      'http://[2002:7f00:1::1]/',
      'http://[2002:a9fe:a9fe::1]/',
      'http://[::1]/hook',
      'http://[::]/hook',
      'http://[fe80::1]/hook',
      'http://[fc00::1]/hook',
      'http://[ff02::1]/hook',
      'http://[2001:db8::1]/hook',
    ];
    for (const url of urls) {
      const seen = new URL(url).hostname;
      await expect(assertSafeWebhookUrl(url), `${url} (guard sees ${seen})`).rejects.toBeInstanceOf(
        UnsafeWebhookUrlError,
      );
    }
  });

  it('still accepts public IPv6 literals', async () => {
    for (const url of ['https://[2606:4700:4700::1111]/hook', 'https://[::ffff:8.8.8.8]/hook']) {
      await expect(assertSafeWebhookUrl(url), url).resolves.toBeInstanceOf(URL);
    }
  });

  it('rejects a hostname that resolves to an IPv6 private address in hex form', async () => {
    for (const address of ['::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '2002:7f00:1::1', 'fe80::1']) {
      await expect(
        assertSafeWebhookUrl('https://evil.example.com/hook', { lookup: resolveTo(address) }),
        address,
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    }
  });
});
