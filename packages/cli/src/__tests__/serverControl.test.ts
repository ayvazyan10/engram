import { describe, it, expect, afterEach } from 'vitest';
import net from 'net';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';

import {
  connectHost,
  pidAlive,
  isPortOpen,
  portListenerPid,
  awaitServerHealthy,
  verifyServer,
} from '../serverControl.js';

/** Listen on an ephemeral port and resolve with the port + a closer. */
function listenTcp(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/** A tiny HTTP server answering 200 on /api/health. */
function listenHealth(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/api/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"status":"ok"}');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

const spawned: ChildProcess[] = [];
function track(child: ChildProcess): ChildProcess {
  spawned.push(child);
  return child;
}

afterEach(() => {
  for (const c of spawned.splice(0)) {
    try { if (c.pid) process.kill(c.pid, 'SIGKILL'); } catch {}
  }
});

describe('connectHost', () => {
  it('maps bind-only addresses to loopback', () => {
    expect(connectHost('0.0.0.0')).toBe('127.0.0.1');
    expect(connectHost('::')).toBe('127.0.0.1');
  });
  it('passes real hosts through unchanged', () => {
    expect(connectHost('127.0.0.1')).toBe('127.0.0.1');
    expect(connectHost('example.com')).toBe('example.com');
  });
});

describe('pidAlive', () => {
  it('is true for the current process', () => {
    expect(pidAlive(process.pid)).toBe(true);
  });
  it('is false for an unused / invalid pid', () => {
    expect(pidAlive(0)).toBe(false);
    expect(pidAlive(-1)).toBe(false);
    expect(pidAlive(2 ** 30)).toBe(false);
  });
});

describe('isPortOpen', () => {
  it('is true while a server listens, false after it closes', async () => {
    const { port, close } = await listenTcp();
    expect(await isPortOpen('127.0.0.1', port, 500)).toBe(true);
    await close();
    expect(await isPortOpen('127.0.0.1', port, 500)).toBe(false);
  });
});

describe('portListenerPid', () => {
  it('returns null for a free port', async () => {
    const { port, close } = await listenTcp();
    await close(); // now free
    expect(portListenerPid(port)).toBeNull();
  });
  it('returns our pid (or null if lsof is unavailable) for a port we own', async () => {
    const { port, close } = await listenTcp();
    const owner = portListenerPid(port);
    expect(owner === process.pid || owner === null).toBe(true);
    await close();
  });

  /**
   * The port reaches this function from ~/.engram/config.json, which
   * `loadConfig` never validated, and it used to be interpolated into a
   * command string handed to a shell. A config holding
   * `"port": "1; touch /tmp/pwned #"` ran the injected command on every
   * `engram status`.
   */
  it('never lets a config value reach a shell', () => {
    const marker = path.join(os.tmpdir(), `engram-portinject-${process.pid}-${Date.now()}`);
    try {
      // Exactly the shape a hand-edited config can carry.
      expect(portListenerPid(`1; touch ${marker} #` as unknown as number)).toBeNull();
      expect(portListenerPid(`$(touch ${marker})` as unknown as number)).toBeNull();
      expect(fs.existsSync(marker), 'the injected command must never have run').toBe(false);
    } finally {
      try { fs.unlinkSync(marker); } catch { /* never created — the point of the test */ }
    }
  });

  it('refuses a port that is not a port instead of asking the system about it', () => {
    for (const bad of [0, -1, 65536, 1.5, NaN]) {
      expect(portListenerPid(bad), String(bad)).toBeNull();
    }
  });
});

describe('awaitServerHealthy', () => {
  it('reports healthy when the child stays alive and the API answers', async () => {
    const { port, close } = await listenHealth();
    const child = track(spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']));
    const result = await awaitServerHealthy(child, '127.0.0.1', port, { attempts: 40, intervalMs: 50 });
    expect(result.healthy).toBe(true);
    expect(result.exited).toBe(false);
    await close();
  });

  it('reports failure (exited) when the child dies before binding', async () => {
    // No health server — child exits immediately with a non-zero code.
    const child = track(spawn(process.execPath, ['-e', 'process.exit(7)']));
    const freePort = 59999;
    const result = await awaitServerHealthy(child, '127.0.0.1', freePort, { attempts: 40, intervalMs: 50 });
    expect(result.healthy).toBe(false);
    expect(result.exited).toBe(true);
    expect(result.exitCode).toBe(7);
  });

  it('stays unhealthy when the child died even though something else answers the port', async () => {
    // `engram update` marks itself degraded off this flag alone, so a foreign
    // process still serving /api/health on the port must not be mistaken for a
    // server that came back up.
    const { port, close } = await listenHealth();
    const child = track(spawn(process.execPath, ['-e', 'process.exit(3)']));
    await new Promise((r) => child.once('exit', r));
    const result = await awaitServerHealthy(child, '127.0.0.1', port, { attempts: 10, intervalMs: 30 });
    expect(result).toEqual({ healthy: false, exited: true, exitCode: 3 });
    await close();
  });

  it('reports failure (not exited) when a live child never becomes healthy', async () => {
    const child = track(spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']));
    const freePort = 59998; // nothing answers here
    const result = await awaitServerHealthy(child, '127.0.0.1', freePort, { attempts: 3, intervalMs: 30 });
    expect(result.healthy).toBe(false);
    expect(result.exited).toBe(false);
  });
});

describe('verifyServer', () => {
  it('is stopped when the pid is dead', () => {
    expect(verifyServer(2 ** 30, 4901)).toEqual({ state: 'stopped' });
  });

  it('is running when our pid owns the port (or lsof cannot tell)', async () => {
    const { port, close } = await listenTcp();
    const result = verifyServer(process.pid, port);
    // lsof present → 'running' (owner === process.pid); lsof absent → owner null → 'running'
    expect(result.state).toBe('running');
    await close();
  });

  it('flags port_mismatch: pid alive but another pid owns the port', async () => {
    const { port, close } = await listenTcp(); // owned by this test process
    const other = track(spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']));
    // Wait for the child to actually be alive.
    await new Promise((r) => setTimeout(r, 100));
    const result = verifyServer(other.pid!, port);
    if (portListenerPid(port) === process.pid) {
      // lsof works here — the alive child does not own the port
      expect(result).toEqual({ state: 'port_mismatch', pid: other.pid, ownerPid: process.pid });
    } else {
      // lsof unavailable — falls back to liveness
      expect(result.state).toBe('running');
    }
    await close();
  });
});
