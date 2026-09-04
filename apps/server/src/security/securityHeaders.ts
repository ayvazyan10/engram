import type { FastifyInstance } from 'fastify';

/**
 * Baseline response security headers.
 *
 * The server hands out the dashboard's HTML from the same origin as the API,
 * so anything that manages to inject markup into a page runs with full access
 * to every memory. None of the standard mitigations were set: no CSP, no
 * `X-Content-Type-Options`, no `Referrer-Policy`, no framing policy.
 *
 * The CSP below is written against what the built dashboard actually loads —
 * see apps/web/dist/index.html — rather than copied from a template:
 *
 *   script-src             The Vite build emits one external module script and
 *                          modulepreload links. There is no inline <script>,
 *                          so no 'unsafe-inline' and no nonce plumbing is
 *                          needed. Swagger UI at /docs is external-script-only
 *                          too, so the same directive covers it.
 *                          `blob:` is NOT decoration: troika-three-text (the
 *                          3D labels) bootstraps its worker by calling
 *                          importScripts() on a blob URL it builds at runtime,
 *                          and importScripts is governed by script-src, not
 *                          worker-src. Without it the console fills with
 *                          "failed to execute 'importScripts'" and every label
 *                          in the graph silently disappears — which is exactly
 *                          what happened: labels rendered under the Vite dev
 *                          server, which sends no CSP, and never rendered from
 *                          the server that actually ships the dashboard. A
 *                          blob: script can only be created by script that is
 *                          already running on this origin, so this permits
 *                          nothing an attacker who can already execute here
 *                          could not do anyway.
 *   style-src              index.html carries an inline <style> for the
 *                          pre-paint background, and Swagger UI injects styles
 *                          at runtime — both need 'unsafe-inline'. The Inter
 *                          webfont is pulled from Google Fonts.
 *   img-src / worker-src   blob: for the WebGL canvas and any loader that
 *                          spins up a worker from a blob URL.
 *   connect-src            'self' covers the REST API and, in every current
 *                          browser, a same-origin WebSocket. The explicit
 *                          loopback ws entries are there for the split
 *                          deployment where the dashboard is served from
 *                          another port than the API. jsdelivr is there
 *                          because troika-three-text (pulled in by the 3D
 *                          text labels) fetches its unicode font index from
 *                          cdn.jsdelivr.net at runtime — grep the built
 *                          assets/react-three-*.js for the URL. Without it
 *                          the canvas silently loses non-Latin glyphs.
 *
 * Override the whole policy with ENGRAM_CSP, or set ENGRAM_CSP=off to send
 * none — a dashboard fork that adds a CDN should not have to patch this file.
 */
const DEFAULT_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://cdn.jsdelivr.net ws://localhost:* ws://127.0.0.1:* wss://localhost:* wss://127.0.0.1:*",
].join('; ');

export interface SecurityHeaderPolicy {
  /** The Content-Security-Policy value, or null to send none. */
  readonly csp: string | null;
  /** HSTS max-age in seconds, or null. Off by default — the server speaks HTTP. */
  readonly hstsMaxAge: number | null;
}

export function readSecurityHeaderPolicy(
  env: NodeJS.ProcessEnv = process.env
): SecurityHeaderPolicy {
  const configured = env['ENGRAM_CSP'];
  const csp =
    configured === undefined || configured.trim() === ''
      ? DEFAULT_CSP
      : configured.trim() === 'off'
        ? null
        : configured.trim();

  // Only meaningful behind TLS, and a wrong value is sticky in the browser for
  // its whole max-age — so it stays opt-in rather than on by default.
  const rawHsts = env['ENGRAM_HSTS_MAX_AGE'];
  const parsedHsts = rawHsts === undefined ? NaN : Number.parseInt(rawHsts, 10);

  return {
    csp,
    hstsMaxAge: Number.isFinite(parsedHsts) && parsedHsts > 0 ? parsedHsts : null,
  };
}

/** The default policy, exported so tests can assert against the real string. */
export const DEFAULT_CONTENT_SECURITY_POLICY = DEFAULT_CSP;

/**
 * Attach the headers to every response.
 *
 * `onSend` rather than `onRequest` so the headers ride along with responses
 * produced by @fastify/static and by the SPA fallback as well as by route
 * handlers. Existing values are never overwritten: @fastify/swagger-ui can be
 * configured to set its own CSP, and a reverse proxy in front of this server
 * may have opinions of its own.
 */
export function installSecurityHeaders(app: FastifyInstance, policy: SecurityHeaderPolicy): void {
  app.addHook('onSend', async (_req, reply, payload) => {
    if (policy.csp !== null && !reply.hasHeader('content-security-policy')) {
      reply.header('Content-Security-Policy', policy.csp);
    }
    if (!reply.hasHeader('x-content-type-options')) {
      reply.header('X-Content-Type-Options', 'nosniff');
    }
    if (!reply.hasHeader('referrer-policy')) {
      reply.header('Referrer-Policy', 'no-referrer');
    }
    if (!reply.hasHeader('x-frame-options')) {
      reply.header('X-Frame-Options', 'DENY');
    }
    if (!reply.hasHeader('cross-origin-opener-policy')) {
      reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    }
    if (policy.hstsMaxAge !== null && !reply.hasHeader('strict-transport-security')) {
      reply.header(
        'Strict-Transport-Security',
        `max-age=${policy.hstsMaxAge}; includeSubDomains`
      );
    }
    return payload;
  });
}
