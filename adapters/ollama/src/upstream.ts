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
  /** Abort a request that never responds, so sockets are not held forever. */
  timeoutMs: number;
}

/** Ollama's own default port, assumed when a plaintext target omits one. */
const DEFAULT_OLLAMA_PORT = 11434;
const DEFAULT_TLS_PORT = 443;

/**
 * The TCP port to dial for a target URL.
 *
 * `new URL('https://host').port` is the empty string, so an https target with
 * no explicit port must fall back to the TLS default — falling through to
 * Ollama's plaintext port instead would speak TLS to the wrong service.
 */
export function upstreamPort(url: URL): number {
  if (url.port !== '') return parseInt(url.port, 10);
  return url.protocol === 'https:' ? DEFAULT_TLS_PORT : DEFAULT_OLLAMA_PORT;
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
    path,
    method,
    headers: { ...headers, host: target.url.host },
  };
}

function protocolFor(target: UpstreamTarget): typeof http | typeof https {
  return target.url.protocol === 'https:' ? https : http;
}

/** Send a request and buffer the whole response. */
export function makeBufferedRequest(
  target: UpstreamTarget,
  path: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer
): Promise<{ status: number; headers: http.OutgoingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const options = requestOptions(target, path, method, {
      ...headers,
      'content-length': body.length.toString(),
    });

    const req = protocolFor(target).request(options, (res) => {
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
    req.setTimeout(target.timeoutMs, () => {
      req.destroy(new Error(`Upstream timed out after ${target.timeoutMs}ms`));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Stream the upstream response straight through to the client while buffering a
 * copy for auto-store.
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
        res.end();
      }
      reject(err);
    };

    const req = protocolFor(target).request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 200, buildResponseHeaders(proxyRes.headers));
      const chunks: Buffer[] = [];
      proxyRes.on('data', (c: Buffer) => { chunks.push(c); res.write(c); });
      proxyRes.on('error', failClient);
      proxyRes.on('end', () => { res.end(); resolve(Buffer.concat(chunks)); });
    });

    req.on('error', failClient);
    req.setTimeout(target.timeoutMs, () => {
      req.destroy(new Error(`Upstream timed out after ${target.timeoutMs}ms`));
    });

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

  const proxyReq = protocolFor(target).request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 200, buildResponseHeaders(proxyRes.headers));
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end('Bad Gateway');
    } else if (!res.writableEnded) {
      res.end();
    }
  });

  proxyReq.write(body);
  proxyReq.end();
}
