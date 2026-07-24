import type http from 'http';

/**
 * Headers never forwarded upstream.
 *
 * `host` / `content-length` are recomputed per request. The hop-by-hop set is
 * per-connection and must not be proxied — forwarding a client's
 * `transfer-encoding` alongside our recomputed `content-length` produces a
 * request with two framings, which is invalid per RFC 7230 and a
 * request-smuggling shape that strict upstreams reject. `accept-encoding` is
 * dropped so responses stay plaintext and remain parseable for auto-store.
 */
export const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'upgrade',
  'accept-encoding',
]);

/** Flatten and filter inbound request headers for forwarding upstream. */
export function buildForwardHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([k]) => !STRIPPED_REQUEST_HEADERS.has(k.toLowerCase()))
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v ?? '')])
  );
}

/** True for endpoints that carry a chat/completion payload we can enrich. */
export function isChatPath(url: string): boolean {
  return (
    url.startsWith('/api/chat') ||
    url.startsWith('/api/generate') ||
    url.startsWith('/v1/chat/completions')
  );
}

/** True for the OpenAI-compatible surface (different response shape). */
export function isOpenAIPath(url: string): boolean {
  return url.startsWith('/v1/');
}
