/**
 * Process-level tests for the proxy entrypoint.
 *
 * proxy.ts binds a socket on import, so it is exercised the way a user runs it:
 * spawned as its own process. That is also the only way to assert the two
 * properties that matter most here — that a hostile request does not *kill* the
 * process, and that a failure to bind exits non-zero.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

const PROXY_ENTRY = path.resolve(process.cwd(), 'src/proxy.ts');
const TSX = path.resolve(process.cwd(), 'node_modules/.bin/tsx');

/** A port nothing listens on — used to make Engram recall fail fast. */
const DEAD_PORT = 1;

interface RunningProxy {
  readonly child: ChildProcess;
  readonly port: number;
  readonly output: () => string;
}

const children: ChildProcess[] = [];
const servers: net.Server[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

/** A stub that answers like Ollama, so the proxy has somewhere to forward to. */
function startUpstream(): Promise<string> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"message":{"role":"assistant","content":"pong"},"done":true}');
      });
    });
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

type SpawnedProxy = Omit<RunningProxy, 'port'>;

function spawnProxy(env: Record<string, string>): SpawnedProxy {
  const child = spawn(TSX, [PROXY_ENTRY], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);

  let output = '';
  child.stdout?.on('data', (c: Buffer) => { output += c.toString(); });
  child.stderr?.on('data', (c: Buffer) => { output += c.toString(); });

  return { child, output: () => output };
}

/**
 * Start the proxy on an ephemeral port and read back the port it bound.
 *
 * Choosing a port in the test — bind a probe, close it, hand the number to a
 * child that binds it milliseconds later — leaves a window in which anything
 * else on the machine can claim it. Under `turbo run test` several suites
 * compete for ports and that window is wide enough to lose. Asking for :0 lets
 * the kernel assign the port to the process that actually holds it, so there is
 * no window at all; the banner is printed from inside the `listen` callback, so
 * seeing it means the socket is already accepting.
 */
async function startProxy(env: Record<string, string>): Promise<RunningProxy> {
  const spawned = spawnProxy({ OLLAMA_PROXY_PORT: '0', ...env });
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    const port = /Listening:\s+http:\/\/[^\s:]+:(\d+)/.exec(spawned.output())?.[1];
    if (port !== undefined) return { ...spawned, port: parseInt(port, 10) };
    if (spawned.child.exitCode !== null) {
      throw new Error(`proxy exited with code ${spawned.child.exitCode}: ${spawned.output()}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`proxy never reported a listen address: ${spawned.output()}`);
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(2000);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

interface Reply {
  readonly status: number;
  readonly body: string;
}

/** POST to the proxy; a killed proxy surfaces as a socket error, not a status. */
function post(port: number, urlPath: string, body: string | Buffer, host = '127.0.0.1'): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const req = http.request(
      { host, port, path: urlPath, method: 'POST', agent: false, headers: { 'content-length': payload.length } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

/** The first non-internal IPv4 address, i.e. how a LAN peer would reach us. */
function externalIPv4(): string | null {
  for (const nics of Object.values(os.networkInterfaces())) {
    for (const nic of nics ?? []) {
      if (nic.family === 'IPv4' && !nic.internal) return nic.address;
    }
  }
  return null;
}

async function startProxyForChat(extra: Record<string, string> = {}): Promise<RunningProxy> {
  const upstream = await startUpstream();
  return startProxy({
    OLLAMA_TARGET: upstream,
    ENGRAM_API: `http://127.0.0.1:${DEAD_PORT}`,
    ...extra,
  });
}

describe('malformed chat bodies', () => {
  it('answers 400 for a null body and keeps serving', async () => {
    const proxy = await startProxyForChat();

    // `curl -X POST /api/chat -d 'null'` used to kill the process: JSON.parse
    // returns null, the cast to Record<string, unknown> lies, and the deref
    // throws inside an async 'end' listener that nothing catches.
    const rejected = await post(proxy.port, '/api/chat', 'null');
    expect(rejected.status).toBe(400);

    expect(proxy.child.exitCode, 'proxy died on a one-line request').toBeNull();

    const ok = await post(
      proxy.port,
      '/api/chat',
      JSON.stringify({ model: 'llama', messages: [{ role: 'user', content: 'ping' }] })
    );
    expect(ok.status).toBe(200);
    expect(ok.body).toContain('pong');
  });

  it('answers 400 for malformed message entries and keeps serving', async () => {
    const proxy = await startProxyForChat();

    for (const payload of [
      '{"messages":[null]}',
      '{"messages":[{"role":"user","content":[null]}]}',
      '{"messages":"not-an-array"}',
      '"just a string"',
    ]) {
      const reply = await post(proxy.port, '/api/chat', payload);
      expect(reply.status, payload).toBe(400);
      expect(proxy.child.exitCode, payload).toBeNull();
    }

    const ok = await post(proxy.port, '/api/chat', JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }));
    expect(ok.status).toBe(200);
  });
});

describe('request body limit', () => {
  it('answers 413 instead of buffering an unbounded body', async () => {
    const proxy = await startProxyForChat({ ENGRAM_MAX_BODY_BYTES: '1024' });

    // The old handler pushed every chunk into an array with no cap, so
    // `--data-binary @/dev/zero` grew RSS until the process was killed.
    const reply = await post(proxy.port, '/api/chat', Buffer.alloc(256 * 1024, 0x41)).catch(
      (err: Error) => err
    );

    // A 413 followed by a dropped socket is also an acceptable outcome for a
    // client that is still uploading; what must not happen is a 200.
    if (reply instanceof Error) {
      expect(reply.message).toMatch(/ECONNRESET|socket hang up|EPIPE/);
    } else {
      expect(reply.status).toBe(413);
    }
    expect(proxy.child.exitCode).toBeNull();

    const ok = await post(proxy.port, '/api/chat', JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }));
    expect(ok.status).toBe(200);
  });
});

describe('listen host', () => {
  const external = externalIPv4();

  it.skipIf(external === null)('binds loopback only by default', async () => {
    const proxy = await startProxyForChat();

    expect(await canConnect('127.0.0.1', proxy.port)).toBe(true);
    // Previously `proxy.listen(PORT)` bound *:11435, so any LAN peer could
    // drive the user's GPU through an unauthenticated proxy.
    expect(await canConnect(external as string, proxy.port), 'proxy is reachable off-host').toBe(false);
    expect(proxy.output()).toContain('ENGRAM_PROXY_HOST');
  });

  it.skipIf(external === null)('binds wider when ENGRAM_PROXY_HOST opts in', async () => {
    const proxy = await startProxyForChat({ ENGRAM_PROXY_HOST: '0.0.0.0' });

    expect(await canConnect(external as string, proxy.port)).toBe(true);
    const ok = await post(
      proxy.port,
      '/api/chat',
      JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }),
      external as string
    );
    expect(ok.status).toBe(200);
  });
});

describe('listen failure', () => {
  it('exits non-zero when the port is already taken', async () => {
    const blocker = net.createServer();
    servers.push(blocker);
    // Bind first, then read the port back: the blocker never lets go of it, so
    // the port really is taken when the proxy tries for it.
    const port = await new Promise<number>((resolve) => {
      blocker.listen(0, '127.0.0.1', () => resolve((blocker.address() as AddressInfo).port));
    });

    const proxy = spawnProxy({
      OLLAMA_PROXY_PORT: String(port),
      ENGRAM_API: `http://127.0.0.1:${DEAD_PORT}`,
    });

    // An idle process that then exits 0 tells a supervisor everything is fine.
    const code = await new Promise<number | null>((resolve) => proxy.child.on('exit', resolve));
    expect(code).toBe(1);
    expect(proxy.output()).toContain('EADDRINUSE');
  });
});
