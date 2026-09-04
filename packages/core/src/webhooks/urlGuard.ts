/**
 * SSRF guard for webhook target URLs.
 *
 * Webhook URLs are attacker-supplyable (the subscribe API takes any string), and
 * deliveries are issued by the server itself — so without validation they are a
 * server-side request forgery primitive against loopback, link-local metadata
 * (169.254.169.254) and RFC1918 hosts.
 *
 * Private targets are denied by default. Set ENGRAM_WEBHOOK_ALLOW_PRIVATE=true
 * to permit them (useful when every consumer is on the same private network).
 */

import dns from 'dns';
import net from 'net';

export class UnsafeWebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeWebhookUrlError';
  }
}

/** Resolve a hostname to its IP addresses. */
export type HostResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (hostname) => {
  const records = await dns.promises.lookup(hostname, { all: true });
  return records.map((r) => r.address);
};

// ─── IPv4 ────────────────────────────────────────────────────────────────────

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function intToIpv4(value: number): string {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join('.');
}

function inCidr(ipInt: number, base: string, prefixBits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = prefixBits === 0 ? 0 : (~0 << (32 - prefixBits)) >>> 0;
  return (ipInt & mask) >>> 0 === (baseInt & mask) >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  const asInt = ipv4ToInt(ip);
  if (asInt === null) return true; // fail closed — unparseable is not proven public
  return (
    inCidr(asInt, '0.0.0.0', 8) ||       // "this" network
    inCidr(asInt, '10.0.0.0', 8) ||      // RFC1918
    inCidr(asInt, '100.64.0.0', 10) ||   // CGNAT
    inCidr(asInt, '127.0.0.0', 8) ||     // loopback
    inCidr(asInt, '169.254.0.0', 16) ||  // link-local (cloud metadata)
    inCidr(asInt, '172.16.0.0', 12) ||   // RFC1918
    inCidr(asInt, '192.0.0.0', 24) ||    // IETF protocol assignments
    inCidr(asInt, '192.168.0.0', 16) ||  // RFC1918
    inCidr(asInt, '198.18.0.0', 15) ||   // benchmarking
    inCidr(asInt, '224.0.0.0', 4) ||     // multicast
    inCidr(asInt, '240.0.0.0', 4)        // reserved
  );
}

// ─── IPv6 ────────────────────────────────────────────────────────────────────

const HEXTETS = 8;

/**
 * Parse a fully hexadecimal IPv6 spelling into its eight 16-bit hextets.
 * Returns null for anything it cannot account for exactly.
 */
function parseHexIpv6(text: string): number[] | null {
  const halves = text.split('::');
  if (halves.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    for (const segment of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(segment)) return null;
      groups.push(parseInt(segment, 16));
    }
    return groups;
  };

  const head = parseGroups(halves[0] ?? '');
  if (head === null) return null;
  if (halves.length === 1) return head.length === HEXTETS ? head : null;

  const tail = parseGroups(halves[1] ?? '');
  if (tail === null) return null;
  const gap = HEXTETS - head.length - tail.length;
  if (gap < 1) return null; // "::" must stand for at least one zero group
  return [...head, ...new Array<number>(gap).fill(0), ...tail];
}

/**
 * Expand any IPv6 spelling to its eight hextets, or null when it is not an
 * IPv6 address.
 *
 * Normalising first is the whole point: the WHATWG `URL` parser always
 * re-serialises an IPv6 host in compressed hex, so `http://[::ffff:127.0.0.1]/`
 * arrives at the guard as `::ffff:7f00:1`. A guard that pattern-matches on one
 * spelling simply never sees the form that reaches the socket.
 */
function expandIpv6(address: string): number[] | null {
  // An RFC 4007 zone id ("fe80::1%eth0") selects an interface; it says nothing
  // about which network the address belongs to, so drop it before parsing.
  const bare = address.split('%')[0] ?? '';
  if (!net.isIPv6(bare)) return null;

  // A trailing dotted quad ("::ffff:127.0.0.1") carries the low 32 bits.
  // Rewrite it as two hextets so there is a single parse path.
  const lastColon = bare.lastIndexOf(':');
  const tail = bare.slice(lastColon + 1);
  if (!tail.includes('.')) return parseHexIpv6(bare);

  const asInt = ipv4ToInt(tail);
  if (asInt === null) return null;
  const hi = ((asInt >>> 16) & 0xffff).toString(16);
  const lo = (asInt & 0xffff).toString(16);
  return parseHexIpv6(`${bare.slice(0, lastColon + 1)}${hi}:${lo}`);
}

/**
 * The IPv4 address carried inside an IPv6 transition address, or null when the
 * address embeds none. Packets to these ultimately reach the embedded IPv4
 * host, so that is the address which must be classified.
 */
function embeddedIpv4(h: readonly number[]): string | null {
  const low32 = (): string => intToIpv4((((h[6] ?? 0) << 16) | (h[7] ?? 0)) >>> 0);
  // True for every ::/64-prefixed form (the top 64 bits are zero).
  const top64Zero = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0;

  // ::ffff:0:0/96 — IPv4-mapped. Serialised by `URL` as "::ffff:7f00:1".
  if (top64Zero && h[4] === 0x0000 && h[5] === 0xffff) return low32();
  // ::ffff:0:0:0/96 — IPv4-translated (RFC 2765 SIIT).
  if (top64Zero && h[4] === 0xffff && h[5] === 0x0000) return low32();
  // 64:ff9b::/96 — well-known NAT64 prefix (RFC 6052).
  if (h[0] === 0x0064 && h[1] === 0xff9b && hextets2to5AreZero(h)) return low32();
  // 2002::/16 — 6to4; the IPv4 endpoint sits in bits 16..48.
  if (h[0] === 0x2002) return intToIpv4(((((h[1] ?? 0) << 16) | (h[2] ?? 0)) >>> 0));

  return null;
}

/** True when hextets 2..5 are zero — the padding of the NAT64 /96 prefix. */
function hextets2to5AreZero(h: readonly number[]): boolean {
  return h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0;
}

function isPrivateIpv6(h: readonly number[]): boolean {
  const embedded = embeddedIpv4(h);
  if (embedded !== null) return isPrivateIpv4(embedded);

  // Allow-list rather than deny-list: only 2000::/3 is allocated as global
  // unicast, so everything outside it is special-purpose by definition —
  // ::/64 (unspecified, loopback, the deprecated IPv4-compatible block),
  // 64:ff9b:1::/48 local-use NAT64, 100::/64 discard-only, fc00::/7
  // unique-local, fe80::/10 link-local, ff00::/8 multicast, and every range
  // IANA has yet to hand out. None of them is a legitimate webhook target.
  if (((h[0] ?? 0) & 0xe000) !== 0x2000) return true;

  // Special-purpose carve-outs that do sit inside 2000::/3.
  const first = h[0] ?? 0;
  const second = h[1] ?? 0;
  if (first === 0x2001 && (second & 0xfe00) === 0x0000) return true; // 2001::/23 IETF protocol assignments (Teredo, benchmarking, ORCHIDv2)
  if (first === 0x2001 && second === 0x0db8) return true;            // 2001:db8::/32 documentation
  if (first === 0x3fff && (second & 0xf000) === 0x0000) return true; // 3fff::/20 documentation (RFC 9637)

  return false;
}

// ─── Classification ──────────────────────────────────────────────────────────

/**
 * True when the address is loopback, private, link-local, CGNAT, multicast,
 * reserved, or otherwise not a public internet destination.
 *
 * Fails closed: anything that is not a parseable IPv4/IPv6 address — a
 * hostname, a truncated literal, junk — is reported as private, because an
 * address we cannot classify is not one we have proven safe.
 */
export function isPrivateAddress(address: string): boolean {
  const ip = address.trim().toLowerCase();
  if (!ip) return true;

  if (net.isIPv4(ip)) return isPrivateIpv4(ip);

  const hextets = expandIpv6(ip);
  if (hextets !== null) return isPrivateIpv6(hextets);

  return true;
}

// ─── URL validation ──────────────────────────────────────────────────────────

export interface UrlGuardOptions {
  /** Permit private/loopback targets. Defaults to ENGRAM_WEBHOOK_ALLOW_PRIVATE. */
  allowPrivate?: boolean;
  /** Injectable DNS resolver (tests). */
  lookup?: HostResolver;
}

/** A webhook URL that passed the guard, plus the addresses it was cleared for. */
export interface SafeWebhookTarget {
  readonly url: URL;
  /**
   * Every address the guard checked and accepted for this URL. Callers MUST
   * connect to one of these and nothing else — re-resolving the hostname at
   * connect time reopens the DNS-rebinding window this list exists to close.
   *
   * Empty when ENGRAM_WEBHOOK_ALLOW_PRIVATE short-circuited the check, in which
   * case no resolution happened and there is nothing to pin.
   */
  readonly addresses: readonly string[];
}

function privateAllowedByEnv(): boolean {
  return process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'] === 'true';
}

function unsafeAddress(hostname: string, address: string): UnsafeWebhookUrlError {
  const where = hostname === address ? `(${address})` : `(${hostname} -> ${address})`;
  return new UnsafeWebhookUrlError(
    `Webhook URL resolves to a private or loopback address ${where}. ` +
      `Set ENGRAM_WEBHOOK_ALLOW_PRIVATE=true to allow it.`
  );
}

/**
 * Validate a webhook URL and return both the URL and the exact addresses it is
 * cleared to reach. Resolves the hostname so a public name pointing at a
 * private address is still rejected.
 */
export async function assertSafeWebhookTarget(
  rawUrl: string,
  options: UrlGuardOptions = {}
): Promise<SafeWebhookTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeWebhookUrlError(`Invalid webhook URL: ${rawUrl}`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UnsafeWebhookUrlError(
      `Webhook URL must use http or https (got ${url.protocol.replace(':', '')})`
    );
  }

  const allowPrivate = options.allowPrivate ?? privateAllowedByEnv();
  if (allowPrivate) return { url, addresses: [] };

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!hostname) throw new UnsafeWebhookUrlError(`Webhook URL has no host: ${rawUrl}`);

  // IP literal — no DNS needed, and the literal is itself the pinned address.
  if (net.isIP(hostname) !== 0) {
    if (isPrivateAddress(hostname)) throw unsafeAddress(hostname, hostname);
    return { url, addresses: [hostname] };
  }

  // A colon in a host that `net.isIP` rejected is an IPv6 literal we could not
  // parse. Fail closed rather than hand it to DNS.
  if (hostname.includes(':')) {
    throw new UnsafeWebhookUrlError(`Webhook URL host is not a usable address: ${hostname}`);
  }

  const resolver = options.lookup ?? defaultResolver;
  let addresses: string[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new UnsafeWebhookUrlError(`Could not resolve webhook host: ${hostname}`);
  }

  if (addresses.length === 0) {
    throw new UnsafeWebhookUrlError(`Could not resolve webhook host: ${hostname}`);
  }

  for (const address of addresses) {
    if (isPrivateAddress(address)) throw unsafeAddress(hostname, address);
  }

  return { url, addresses: [...addresses] };
}

/**
 * Validate a webhook URL, throwing UnsafeWebhookUrlError when it is not a safe
 * delivery target.
 *
 * Prefer {@link assertSafeWebhookTarget} when you are about to open a socket:
 * it hands back the validated addresses so the connection can be pinned to
 * them instead of being re-resolved.
 */
export async function assertSafeWebhookUrl(
  rawUrl: string,
  options: UrlGuardOptions = {}
): Promise<URL> {
  const target = await assertSafeWebhookTarget(rawUrl, options);
  return target.url;
}
