/**
 * Network-path tests against a stub upstream.
 *
 * These cover the failure modes that previously hung clients or crashed the
 * proxy: streamRequest writing nothing on upstream error, the response stream
 * having no 'error' listener, and no request timeout at all.
 */

import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

import { makeBufferedRequest, streamRequest, passthrough, upstreamPort, type UpstreamTarget } from '../upstream.js';
import { buildForwardHeaders, buildResponseHeaders, isChatPath, isOpenAIPath } from '../headers.js';

const servers: http.Server[] = [];

function startServer(handler: http.RequestListener): Promise<{ target: UpstreamTarget; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ target: { url: new URL(`http://127.0.0.1:${port}`), timeoutMs: 2000 }, port });
    });
  });
}

/** A target pointing at a port with nothing listening. */
async function deadTarget(): Promise<UpstreamTarget> {
  const { port } = await startServer(() => {});
  await new Promise<void>((r) => servers.pop()!.close(() => r()));
  return { url: new URL(`http://127.0.0.1:${port}`), timeoutMs: 1000 };
}

/** Drive a handler through a real client request and capture the raw response. */
function callThrough(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const proxyServer = http.createServer(handler);
    servers.push(proxyServer);
    proxyServer.listen(0, '127.0.0.1', () => {
      const port = (proxyServer.address() as AddressInfo).port;
      // agent:false — avoid keep-alive sockets keeping the server open in afterEach.
      const req = http.request({ hostname: '127.0.0.1', port, path: '/api/chat', method: 'POST', agent: false }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString(), headers: res.headers })
        );
      });
      req.on('error', reject);
      req.end('{}');
    });
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

describe('makeBufferedRequest', () => {
  it('buffers the full upstream response', async () => {
    const { target } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"message":{"content":"ok"},"done":true}');
    });

    const result = await makeBufferedRequest(target, '/api/chat', 'POST', {}, Buffer.from('{}'));
    expect(result.status).toBe(200);
    expect(result.body.toString()).toContain('"ok"');
  });

  it('forwards the request body and recomputes content-length', async () => {
    let seenLength: string | undefined;
    let seenBody = '';
    const { target } = await startServer((req, res) => {
      seenLength = req.headers['content-length'];
      req.on('data', (c: Buffer) => { seenBody += c.toString(); });
      req.on('end', () => { res.end('{}'); });
    });

    const payload = Buffer.from('{"model":"llama"}');
    await makeBufferedRequest(target, '/api/chat', 'POST', {}, payload);

    expect(seenBody).toBe('{"model":"llama"}');
    expect(seenLength).toBe(String(payload.length));
  });

  it('rejects when the upstream is unreachable', async () => {
    const target = await deadTarget();
    await expect(
      makeBufferedRequest(target, '/api/chat', 'POST', {}, Buffer.from('{}')),
    ).rejects.toBeInstanceOf(Error);
  });

  it('times out instead of hanging forever on a silent upstream', async () => {
    const { target } = await startServer(() => {
      // Never respond.
    });
    const fast: UpstreamTarget = { url: target.url, timeoutMs: 150 };

    await expect(
      makeBufferedRequest(fast, '/api/chat', 'POST', {}, Buffer.from('{}')),
    ).rejects.toThrow(/timed out/i);
  });
});

describe('streamRequest', () => {
  it('streams the upstream body to the client and resolves with a copy', async () => {
    const { target } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write('{"message":{"content":"a"},"done":false}\n');
      res.end('{"message":{"content":"b"},"done":true}\n');
    });

    let captured = '';
    const response = await callThrough((req, res) => {
      void streamRequest(target, '/api/chat', 'POST', {}, Buffer.from('{}'), res)
        .then((buf) => { captured = buf.toString(); })
        .catch(() => {});
      void req;
    });

    expect(response.status).toBe(200);
    expect(response.body).toContain('"a"');
    expect(response.body).toContain('"b"');
    // Give the promise a tick to settle after the client saw 'end'.
    await new Promise((r) => setTimeout(r, 50));
    expect(captured).toContain('"b"');
  });

  it('answers the client with 502 when the upstream is unreachable', async () => {
    const target = await deadTarget();

    // Previously nothing was written here and the client hung until its own
    // timeout, while the caller assumed the error had been reported.
    const response = await callThrough((_req, res) => {
      void streamRequest(target, '/api/chat', 'POST', {}, Buffer.from('{}'), res).catch(() => {});
    });

    expect(response.status).toBe(502);
    expect(response.body).toBe('Bad Gateway');
  });

  it('ends the response instead of hanging when the upstream dies mid-stream', async () => {
    const { target } = await startServer((_req, res) => {
      res.writeHead(200);
      res.write('{"message":{"content":"partial"},"done":false}\n', () => {
        // Destroy only once the chunk is actually flushed, so the proxy has
        // already forwarded the head — otherwise this races and legitimately
        // produces a 502 (headers not yet sent), which is a different path.
        setTimeout(() => res.socket?.destroy(), 30);
      });
    });

    const response = await callThrough((_req, res) => {
      void streamRequest(target, '/api/chat', 'POST', {}, Buffer.from('{}'), res).catch(() => {});
    });

    // The client must get a terminated response rather than an open socket.
    expect(response.status).toBe(200);
    expect(response.body).toContain('partial');
  });
});

describe('passthrough', () => {
  it('proxies a non-chat request verbatim', async () => {
    const { target } = await startServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ path: req.url }));
    });

    const response = await callThrough((req, res) => {
      passthrough(target, req, res, Buffer.from(''));
    });

    expect(response.status).toBe(200);
    expect(response.body).toContain('/api/chat');
  });

  it('returns 502 when the upstream is unreachable', async () => {
    const target = await deadTarget();
    const response = await callThrough((req, res) => {
      passthrough(target, req, res, Buffer.from(''));
    });
    expect(response.status).toBe(502);
  });
});

describe('header forwarding', () => {
  it('strips hop-by-hop headers so framing cannot be duplicated', () => {
    const forwarded = buildForwardHeaders({
      host: 'proxy.local',
      'content-length': '99',
      'transfer-encoding': 'chunked',
      connection: 'keep-alive',
      'accept-encoding': 'gzip',
      te: 'trailers',
      upgrade: 'h2c',
      authorization: 'Bearer secret',
      'x-custom': 'keep-me',
    });

    for (const dropped of ['host', 'content-length', 'transfer-encoding', 'connection', 'accept-encoding', 'te', 'upgrade']) {
      expect(forwarded, dropped).not.toHaveProperty(dropped);
    }
    // End-to-end headers must survive.
    expect(forwarded['authorization']).toBe('Bearer secret');
    expect(forwarded['x-custom']).toBe('keep-me');
  });

  it('joins array-valued headers', () => {
    expect(buildForwardHeaders({ 'x-multi': ['a', 'b'] })['x-multi']).toBe('a, b');
  });

  it('is case-insensitive when stripping', () => {
    const forwarded = buildForwardHeaders({ 'Transfer-Encoding': 'chunked' } as never);
    expect(forwarded).not.toHaveProperty('Transfer-Encoding');
  });
});

describe('path classification', () => {
  it('recognises chat paths', () => {
    for (const p of ['/api/chat', '/api/generate', '/v1/chat/completions']) {
      expect(isChatPath(p), p).toBe(true);
    }
    for (const p of ['/api/tags', '/api/pull', '/v1/models', '/']) {
      expect(isChatPath(p), p).toBe(false);
    }
  });

  it('recognises the OpenAI surface', () => {
    expect(isOpenAIPath('/v1/chat/completions')).toBe(true);
    expect(isOpenAIPath('/api/chat')).toBe(false);
  });
});

describe('upstreamPort', () => {
  it('uses the explicit port when the target URL carries one', () => {
    expect(upstreamPort(new URL('http://localhost:11434'))).toBe(11434);
    expect(upstreamPort(new URL('https://ollama.example.com:8443'))).toBe(8443);
  });

  it('falls back to 443 for an https target with no port', () => {
    // `new URL('https://host').port` is '', so `parseInt('') || 11434` used to
    // send TLS traffic to Ollama's plaintext port instead of the TLS default.
    expect(upstreamPort(new URL('https://ollama.example.com'))).toBe(443);
  });

  it("keeps Ollama's default port for an http target with no port", () => {
    expect(upstreamPort(new URL('http://localhost'))).toBe(11434);
  });
});

describe('passthrough header hygiene', () => {
  it('strips hop-by-hop request headers on non-chat paths', async () => {
    let seen: http.IncomingHttpHeaders | null = null;
    const { target } = await startServer((req, res) => {
      seen = req.headers;
      req.resume();
      req.on('end', () => res.end('{}'));
    });

    // A synthetic request: a real Node client normalises the very headers this
    // test is about, so the inbound header set is supplied directly.
    const inbound = {
      url: '/api/tags',
      method: 'POST',
      headers: {
        'transfer-encoding': 'chunked',
        connection: 'upgrade',
        upgrade: 'h2c',
        te: 'trailers',
        'keep-alive': 'timeout=5',
        'proxy-authorization': 'Basic c2VjcmV0',
        'content-length': '999',
        authorization: 'Bearer keep-me',
        'x-custom': 'keep-me',
      },
    } as unknown as http.IncomingMessage;

    await callThrough((_req, res) => {
      passthrough(target, inbound, res, Buffer.from('{}'));
    });

    // Forwarding the client's `transfer-encoding` next to a recomputed
    // `content-length` is the double-framing shape strict upstreams reject —
    // when that happens the request never arrives at all.
    expect(seen, 'upstream received no well-framed request').not.toBeNull();
    const headers = seen as unknown as http.IncomingHttpHeaders;

    for (const dropped of ['transfer-encoding', 'upgrade', 'te', 'keep-alive', 'proxy-authorization']) {
      expect(headers, dropped).not.toHaveProperty(dropped);
    }
    // Node's own client always sets `connection`; what must not survive is the
    // client's value, which is what turns a proxied request into an upgrade.
    expect(headers['connection']).not.toBe('upgrade');
    // Framing is recomputed from the body we actually forward, never copied.
    expect(headers['content-length']).toBe('2');
    // Deliberate: the upstream host is fixed from env, so Authorization is ours to forward.
    expect(headers['authorization']).toBe('Bearer keep-me');
    expect(headers['x-custom']).toBe('keep-me');
  });

  it('strips hop-by-hop headers from the response it forwards', async () => {
    const { target } = await startServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'keep-alive': 'timeout=5',
        'proxy-authenticate': 'Basic realm="x"',
        upgrade: 'h2c',
        trailer: 'x-trace',
        'x-keep': 'yes',
      });
      res.end('{}');
    });

    const response = await callThrough((req, res) => {
      passthrough(target, req, res, Buffer.from(''));
    });

    for (const dropped of ['keep-alive', 'proxy-authenticate', 'upgrade', 'trailer']) {
      expect(response.headers, dropped).not.toHaveProperty(dropped);
    }
    expect(response.headers['x-keep']).toBe('yes');
  });
});

describe('response header hygiene', () => {
  it('strips hop-by-hop headers on the streaming path', async () => {
    const { target } = await startServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/x-ndjson',
        'keep-alive': 'timeout=5',
        upgrade: 'h2c',
        trailer: 'x-trace',
        'x-keep': 'yes',
      });
      res.end('{"message":{"content":"a"},"done":true}\n');
    });

    const response = await callThrough((_req, res) => {
      void streamRequest(target, '/api/chat', 'POST', {}, Buffer.from('{}'), res).catch(() => {});
    });

    for (const dropped of ['keep-alive', 'upgrade', 'trailer']) {
      expect(response.headers, dropped).not.toHaveProperty(dropped);
    }
    expect(response.headers['x-keep']).toBe('yes');
    expect(response.body).toContain('"a"');
  });

  it('filters the buffered response headers the caller forwards', async () => {
    const { target } = await startServer((_req, res) => {
      res.writeHead(200, { 'keep-alive': 'timeout=5', upgrade: 'h2c', 'x-keep': 'yes' });
      res.end('{}');
    });

    const result = await makeBufferedRequest(target, '/api/chat', 'POST', {}, Buffer.from('{}'));
    for (const dropped of ['keep-alive', 'upgrade', 'connection']) {
      expect(result.headers, dropped).not.toHaveProperty(dropped);
    }
    expect(result.headers['x-keep']).toBe('yes');
  });

  it('buildResponseHeaders keeps end-to-end headers and array values', () => {
    const filtered = buildResponseHeaders({
      connection: 'keep-alive',
      'transfer-encoding': 'chunked',
      'Proxy-Authenticate': 'Basic',
      'content-length': '2',
      'set-cookie': ['a=1', 'b=2'],
      'content-type': 'application/json',
    } as never);

    for (const dropped of ['connection', 'transfer-encoding', 'Proxy-Authenticate']) {
      expect(filtered, dropped).not.toHaveProperty(dropped);
    }
    expect(filtered['content-length']).toBe('2');
    expect(filtered['set-cookie']).toEqual(['a=1', 'b=2']);
    expect(filtered['content-type']).toBe('application/json');
  });
});
