/**
 * `engram import` end to end against a local stand-in for the API.
 *
 * cli.ts parses argv and registers commands as a side effect of import, so it
 * cannot be loaded in-process (see vitest.config.ts). These spawn the real
 * entrypoint through tsx with a temporary ENGRAM_HOME pointing at a mock server
 * on an ephemeral port.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CLI = path.join(__dirname, '..', 'cli.ts');
const TSX = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'tsx');

let home: string;
let server: http.Server;
let received: Array<Record<string, unknown>>;

const runImport = (input: string): Promise<{ status: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    const child = spawn(TSX, [CLI, 'import'], {
      env: { ...process.env, ENGRAM_HOME: home },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input);
  });

const memory = (data: Record<string, unknown>): string => JSON.stringify({ type: 'memory', data });

beforeEach(async () => {
  received = [];
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-import-'));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    host: '127.0.0.1',
    port: (server.address() as AddressInfo).port,
  }));
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(home, { recursive: true, force: true });
});

describe('import', () => {
  it('imports a single-record NDJSON document', async () => {
    const result = await runImport(memory({ content: 'hello' }));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Found 1 memories to import');
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ content: 'hello' });
  });

  it('keeps a JSON export with a memories array working', async () => {
    const result = await runImport(JSON.stringify({ memories: [{ content: 'a' }, { content: 'b' }] }));

    expect(result.status).toBe(0);
    expect(received).toHaveLength(2);
  });

  it('sends sessionId and metadata, parsing a JSON-string metadata field', async () => {
    const input = [
      memory({ content: 'one', sessionId: 's1', metadata: '{"origin":"x"}' }),
      memory({ content: 'two', sessionId: 's2', metadata: { origin: 'y' } }),
    ].join('\n');
    const result = await runImport(input);

    expect(result.status).toBe(0);
    expect(received[0]).toMatchObject({ content: 'one', sessionId: 's1', metadata: { origin: 'x' } });
    expect(received[1]).toMatchObject({ content: 'two', sessionId: 's2', metadata: { origin: 'y' } });
  });

  it('counts a bad metadata string as a skip instead of crashing', async () => {
    const input = [memory({ content: 'good' }), memory({ content: 'bad', metadata: '{not json' })].join('\n');
    const result = await runImport(input);

    expect(result.status).toBe(1);
    expect(received).toHaveLength(1);
    expect(result.stdout).toContain('Imported: 1  Skipped: 1');
  });

  it('counts malformed NDJSON lines in skipped and exits 1 after importing the good ones', async () => {
    const input = `${memory({ content: 'good' })}\n{not json`;
    const result = await runImport(input);

    expect(result.status).toBe(1);
    expect(received).toHaveLength(1);
    expect(result.stdout).toContain('Imported: 1  Skipped: 1');
  });
});
