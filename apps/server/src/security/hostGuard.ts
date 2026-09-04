import net from 'net';
import type { FastifyInstance } from 'fastify';
import { pathnameOf } from '../lib/requestPath.js';

/**
 * Host header allowlist — the REST half of the DNS-rebinding defense.
 *
 * The WebSocket half was closed last round with an Origin allowlist in
 * `allowRequest`. Origin cannot close this half: `isAllowedOrigin(undefined)`
 * returns true because non-browser clients (CLI, MCP, curl) send no Origin at
 * all, and a same-origin browser GET sends none either. So an attacker page
 * served from `http://attacker.example:4901`, whose A record then flips to
 * 127.0.0.1, can `fetch('/api/memory')` and the request arrives with no Origin
 * and is allowed.
 *
 * What such a request cannot hide is the Host header — it carries the
 * attacker's own domain name, because that is what the browser connected to.
 * Hence a Host allowlist rather than an Origin one.
 *
 * The default policy is the one Vite, webpack-dev-server and Jupyter settled
 * on, and it breaks nothing that works today:
 *
 *   - An IP literal is always allowed. Rebinding needs a NAME whose answer can
 *     change; `http://192.168.1.5:4901` has no name to repoint, so LAN access
 *     by address keeps working.
 *   - `localhost` (and `*.localhost`, reserved by RFC 6761) is allowed. That
 *     covers the local-first default and the container healthcheck.
 *   - Any other hostname must be listed in ENGRAM_ALLOWED_HOSTS. A reverse
 *     proxy that forwards its own Host (`api:4901`, `engram.example.com`)
 *     needs one entry; see docker-compose.yml.
 *
 * `ENGRAM_ALLOWED_HOSTS=*` turns the check off for deployments that terminate
 * it elsewhere.
 */

export interface HostPolicy {
  /** Extra hostnames allowed beyond IP literals and localhost. */
  readonly allowed: readonly string[];
  /** True when the operator opted out entirely with '*'. */
  readonly disabled: boolean;
}

export function readHostPolicy(env: NodeJS.ProcessEnv = process.env): HostPolicy {
  const raw = env['ENGRAM_ALLOWED_HOSTS'] ?? '';
  const entries = raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  return { allowed: entries.filter((h) => h !== '*'), disabled: entries.includes('*') };
}

/**
 * The hostname from a Host header, port stripped and IPv6 brackets removed.
 * Returns null when the header is absent or unparseable — both are refused.
 */
export function hostnameOf(hostHeader: string | undefined): string | null {
  if (typeof hostHeader !== 'string') return null;
  const trimmed = hostHeader.trim().toLowerCase();
  if (trimmed === '') return null;

  // Bracketed IPv6: "[::1]:4901".
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    return end > 1 ? trimmed.slice(1, end) : null;
  }

  const firstColon = trimmed.indexOf(':');
  if (firstColon === -1) return trimmed;
  // More than one colon means a bare IPv6 literal, which is not legal in a
  // Host header but costs nothing to accept rather than truncate wrongly.
  if (trimmed.indexOf(':', firstColon + 1) !== -1) return trimmed;
  return trimmed.slice(0, firstColon) || null;
}

export function isAllowedHost(hostHeader: string | undefined, policy: HostPolicy): boolean {
  if (policy.disabled) return true;

  const host = hostnameOf(hostHeader);
  if (host === null) return false;

  // An address literal cannot be the target of a rebind — there is no name to
  // repoint — so it is allowed regardless of which address it is.
  if (net.isIP(host) !== 0) return true;

  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  return policy.allowed.includes(host);
}

/**
 * Refuse /api/* requests whose Host is not allowlisted.
 *
 * Scoped to /api/* on purpose. The dashboard shell and its static bundle stay
 * reachable under any Host: they hold no data, and gating them would recreate
 * the problem the static-asset exemption was added to fix (a browser cannot
 * put anything on a top-level navigation). A rebound page can therefore still
 * load the HTML — and get nothing from it, because every read and write lives
 * under /api/.
 */
export function installHostGuard(app: FastifyInstance, policy: HostPolicy): void {
  if (policy.disabled) return;

  app.addHook('onRequest', async (req, reply) => {
    if (!pathnameOf(req.url).startsWith('/api/')) return;
    if (isAllowedHost(req.headers.host, policy)) return;

    req.log.warn({ host: req.headers.host, url: req.url }, 'refused request with a non-allowlisted Host');
    await reply.code(403).send({
      error: 'Forbidden',
      message:
        "Host header is not allowlisted. Set ENGRAM_ALLOWED_HOSTS to the hostname this server is reached by (comma-separated, '*' to disable).",
    });
  });
}
