/**
 * Upstream request helpers.
 *
 * The target is passed in rather than read from module state so these can be
 * pointed at a stub server in tests.
 */

import http from 'http';
import https from 'https';

import { buildForwardHeaders, buildResponseHeaders } from './headers.js';

export interface UpstreamTarget {
  url: URL;
  /** Deadline for connection setup and the entire upstream response. */
  timeoutMs: number;
}

/** Larger replies still stream in full, but do not become memories. */
const MAX_CAPTURE_BYTES = 1024 * 1024;

export function upstreamPort(url: URL): number {
  if (url.port !== '') return parseInt(url.port, 10);
  return url.protocol === 'https:' ? 443 : 80;
}

/**
 * Join the target URL's path prefix with the incoming request path.
 *
 * `ENGRAM_UPSTREAM=https://openrouter.ai/api` means a request for
 * `/v1/chat/completions` has to reach `/api/v1/chat/completions`. A target
 * with no path (the Ollama default) leaves the request path unchanged.
 */
function requestPath(target: UpstreamTarget, path: string | undefined): string {
  const base = target.url.pathname.replace(/\/+$/, '');
  const incoming = path ?? '/';
  return `${base}${incoming.startsWith('/') ? incoming : `/${incoming}`}` || '/';
}

function requestOptions(
  target: UpstreamTarget,
  path: string | undefined,
  method: string | undefined,
  headers: Record<string, string>
): http.RequestOptions {
  return {
    hostname: target.url.hostname,
    port: upstreamPort(target.url),
    path: requestPath(target, path),
    method,
    headers: { ...headers, host: target.url.host },
  };
}

function protocolFor(target: UpstreamTarget): typeof http | typeof https {
  return target.url.protocol === 'https:' ? https : http;
}

function setDeadline(req: http.ClientRequest, timeoutMs: number): void {
  const timer = setTimeout(() => req.destroy(new Error(`Upstream timed out after ${timeoutMs}ms`)), timeoutMs);
  req.once('close', () => clearTimeout(timer));
}

/** Send a request and buffer the whole response. */
export function makeBufferedRequest(
  target: UpstreamTarget,
  path: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer,
  signal?: AbortSignal
): Promise<{ status: number; headers: http.OutgoingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const options = requestOptions(target, path, method, {
      ...headers,
      'content-length': body.length.toString(),
    });

    const req = protocolFor(target).request({ ...options, signal }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      // The response stream needs its own 'error' listener: a mid-response
      // socket reset would otherwise emit an unhandled 'error' and crash.
      res.on('error', reject);
      // Filtered here rather than at the call site: the caller forwards these
      // verbatim, so every path must get the hop-by-hop set removed.
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 200,
          headers: buildResponseHeaders(res.headers),
          body: Buffer.concat(chunks),
        })
      );
    });

    req.on('error', reject);
    setDeadline(req, target.timeoutMs);
    req.write(body);
    req.end();
  });
}

/**
 * Stream the upstream response, returning an empty buffer if it exceeds the
 * auto-store capture limit.
 *
 * On failure this function answers the client itself — the caller cannot,
 * because headers may already have been sent.
 */
export function streamRequest(
  target: UpstreamTarget,
  path: string,
  method: string,
  reqHeaders: Record<string, string>,
  body: Buffer,
  res: http.ServerResponse
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const options = requestOptions(target, path, method, {
      ...reqHeaders,
      'content-length': body.length.toString(),
    });

    const failClient = (err: Error) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway');
      } else if (!res.writableEnded) {
        res.destroy();
      }
      reject(err);
    };

    const req = protocolFor(target).request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 200, buildResponseHeaders(proxyRes.headers));
      let capture: Buffer | undefined = Buffer.allocUnsafe(MAX_CAPTURE_BYTES);
      let size = 0;
      proxyRes.on('data', (chunk: Buffer) => {
        if (!capture) return;
        if (size + chunk.length > capture.length) capture = undefined;
        else size += chunk.copy(capture, size);
      });
      proxyRes.on('error', failClient);
      proxyRes.on('end', () => resolve(capture?.subarray(0, size) ?? Buffer.alloc(0)));
      proxyRes.pipe(res);
    });

    req.on('error', failClient);
    setDeadline(req, target.timeoutMs);

    // Client went away — release the upstream instead of streaming into a dead socket.
    res.on('close', () => {
      if (!res.writableEnded) req.destroy();
    });

    req.write(body);
    req.end();
  });
}

/**
 * Proxy a request whose body we do not enrich.
 *
 * "Verbatim" applies to the body, never to the headers: these go through the
 * same filter as the chat paths. Forwarding a client's `connection` /
 * `transfer-encoding` / `upgrade` alongside the `content-length` recomputed
 * from the body we actually hold is the duplicated-framing shape documented in
 * headers.ts, and it reached the upstream on every non-chat path.
 */
export function passthrough(
  target: UpstreamTarget,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: Buffer
): void {
  const options = requestOptions(target, req.url, req.method, {
    ...buildForwardHeaders(req.headers),
    'content-length': body.length.toString(),
  });

  const failClient = () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway');
    } else if (!res.writableEnded) {
      res.destroy();
    }
  };

  const proxyReq = protocolFor(target).request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 200, buildResponseHeaders(proxyRes.headers));
    // Without this listener a mid-body reset on the upstream socket is an
    // unhandled 'error' event, which takes the whole proxy process down.
    proxyRes.on('error', failClient);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', failClient);
  setDeadline(proxyReq, target.timeoutMs);

  // Client went away — release the upstream instead of holding its socket.
  res.on('close', () => {
    if (!res.writableEnded) proxyReq.destroy();
  });

  proxyReq.write(body);
  proxyReq.end();
}
