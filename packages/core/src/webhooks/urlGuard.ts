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

function inCidr(ipInt: number, base: string, prefixBits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = prefixBits === 0 ? 0 : (~0 << (32 - prefixBits)) >>> 0;
  return (ipInt & mask) >>> 0 === (baseInt & mask) >>> 0;
}

/**
 * True when the address is loopback, private, link-local, CGNAT, multicast,
 * reserved, or otherwise not a public internet destination.
 */
export function isPrivateAddress(address: string): boolean {
  const ip = address.trim().toLowerCase();
  if (!ip) return true;

  // IPv4-mapped IPv6 (::ffff:127.0.0.1) — judge on the embedded IPv4.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]!);

  const asInt = ipv4ToInt(ip);
  if (asInt !== null) {
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

  // IPv6
  if (ip === '::1' || ip === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true;                 // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return true;                 // fe80::/10 link-local
  if (/^ff[0-9a-f]{2}:/.test(ip)) return true;                    // multicast

  return false;
}

export interface UrlGuardOptions {
  /** Permit private/loopback targets. Defaults to ENGRAM_WEBHOOK_ALLOW_PRIVATE. */
  allowPrivate?: boolean;
  /** Injectable DNS resolver (tests). */
  lookup?: HostResolver;
}

function privateAllowedByEnv(): boolean {
  return process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'] === 'true';
}

/**
 * Validate a webhook URL, throwing UnsafeWebhookUrlError when it is not a safe
 * delivery target. Resolves the hostname so a public name pointing at a private
 * address is still rejected.
 */
export async function assertSafeWebhookUrl(
  rawUrl: string,
  options: UrlGuardOptions = {}
): Promise<URL> {
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
  if (allowPrivate) return url;

  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  // IP literal — no DNS needed.
  if (ipv4ToInt(hostname) !== null || hostname.includes(':')) {
    if (isPrivateAddress(hostname)) {
      throw new UnsafeWebhookUrlError(
        `Webhook URL resolves to a private or loopback address (${hostname}). ` +
          `Set ENGRAM_WEBHOOK_ALLOW_PRIVATE=true to allow it.`
      );
    }
    return url;
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
    if (isPrivateAddress(address)) {
      throw new UnsafeWebhookUrlError(
        `Webhook host ${hostname} resolves to a private or loopback address (${address}). ` +
          `Set ENGRAM_WEBHOOK_ALLOW_PRIVATE=true to allow it.`
      );
    }
  }

  return url;
}
