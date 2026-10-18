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
let requests: Array<{ method: string | undefined; url: string | undefined; size: number }>;
let responseStatus: number;

const runImport = (input: string, args: string[] = []): Promise<{ status: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(TSX, [CLI, 'import', ...args], {
      env: { ...process.env, ENGRAM_HOME: home },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input);
  });

const memory = (data: Record<string, unknown>): string => JSON.stringify({ type: 'memory', data });

beforeEach(async () => {
  received = [];
  requests = [];
  responseStatus = 201;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-import-'));
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      const records = req.url === '/api/memory/batch' ? body.memories as Array<Record<string, unknown>> : [body];
      received.push(...records);
      requests.push({ method: req.method, url: req.url, size: records.length });
      res.writeHead(responseStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: records.length }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
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
    expect(requests).toEqual([{ method: 'POST', url: '/api/memory', size: 1 }]);
  });

  it('keeps a JSON export with a memories array working', async () => {
    const result = await runImport(JSON.stringify({ memories: [{ content: 'a' }, { content: 'b' }] }));

    expect(result.status).toBe(0);
    expect(received).toHaveLength(2);
    expect(requests).toEqual([
      { method: 'POST', url: '/api/memory', size: 1 },
      { method: 'POST', url: '/api/memory', size: 1 },
    ]);
  });

  it.each([
    ['JSON', JSON.stringify({ memories: [{ content: 'a' }, { content: 'b' }] })],
    ['NDJSON', [memory({ content: 'a' }), memory({ content: 'b' })].join('\n')],
  ])('previews stdin %s without posting', async (_format, input) => {
    const result = await runImport(input, ['--dry-run']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Found 2 memories to import');
    expect(result.stdout).toContain('Dry run — no changes.');
    expect(requests).toEqual([]);
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

const fixture = (name: string, content: string): string => {
  const file = path.join(home, 'fixtures', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};

describe('import --from', () => {
  it('imports top-level markdown bullets with nested and continued text intact', async () => {
    const file = fixture('CLAUDE.md', '- Prefer TypeScript\n  Keep strict checks.\n  - Include tests\n- Use pnpm\n');
    const result = await runImport('', ['--from', 'markdown', file]);

    expect(result.status).toBe(0);
    expect(received).toEqual([
      { content: 'Prefer TypeScript\n  Keep strict checks.\n  - Include tests', type: 'semantic',
        source: 'import', tags: ['import:markdown', 'CLAUDE.md'] },
      { content: 'Use pnpm', type: 'semantic', source: 'import', tags: ['import:markdown', 'CLAUDE.md'] },
    ]);
    expect(requests).toEqual([{ method: 'POST', url: '/api/memory/batch', size: 2 }]);
    expect(result.stdout).toContain('Imported: 2  Skipped: 0');
  });

  it('uses markdown headings as concepts and keeps each section together', async () => {
    const file = fixture('AGENTS.md', '# Preferences\n- Use TypeScript\n- Use pnpm\n\n## Workflow\nRun tests.\n');
    const result = await runImport('', ['--from', 'markdown', file]);

    expect(result.status).toBe(0);
    expect(received).toEqual([
      { content: '- Use TypeScript\n- Use pnpm', concept: 'Preferences', type: 'semantic',
        source: 'import', tags: ['import:markdown', 'AGENTS.md'] },
      { content: 'Run tests.', concept: 'Workflow', type: 'semantic',
        source: 'import', tags: ['import:markdown', 'AGENTS.md'] },
    ]);
  });

  it.each(['user', 'feedback', 'project', 'reference'])('imports a frontmatter %s memory as one semantic record', async (type) => {
    const file = fixture('projects/example/memory/preference.md',
      `---\nname: "User preferences"\ndescription: Coding preferences\nmetadata:\n  type: ${type}\n---\n# Preferences\n- Use pnpm\n- Run tests\n`);
    const result = await runImport('', ['--from', 'markdown', file]);

    expect(result.status).toBe(0);
    expect(received).toEqual([{
      content: '# Preferences\n- Use pnpm\n- Run tests', concept: 'User preferences', type: 'semantic',
      source: 'import', tags: ['import:markdown', 'preference.md'],
    }]);
  });

  it('recurses over markdown files and skips a MEMORY.md index', async () => {
    fixture('memory/MEMORY.md', '# Memory index\n\n- [Preferences](preferences.md) — coding style\n');
    fixture('memory/preferences.md', '- Use TypeScript');
    fixture('memory/nested/workflow.md', '- Run tests');
    fixture('memory/ignored.txt', 'Do not import');
    const result = await runImport('', ['--from', 'markdown', path.join(home, 'fixtures', 'memory')]);

    expect(result.status).toBe(0);
    expect(received).toHaveLength(2);
    expect(received.map((record) => record.tags)).toEqual([
      ['import:markdown', 'workflow.md'], ['import:markdown', 'preferences.md'],
    ]);
    expect(result.stdout).toContain('Imported: 2  Skipped: 0');
  });

  it('skips a standalone MEMORY.md index without contacting the API', async () => {
    const file = fixture('MEMORY.md', '- [Preferences](preferences.md) — coding style');
    const result = await runImport('', ['--from', 'markdown', file]);

    expect(result.status).toBe(1); // Preserve the existing empty-import exit code.
    expect(result.stdout).toContain('Found 0 memories to import');
    expect(requests).toEqual([]);
  });

  it.each(['chatgpt', 'claude'])('imports %s plain text, stripping bullets and blank lines', async (format) => {
    const file = fixture('facts.txt', '- Use TypeScript\r\n\r\n* Use pnpm\r\n• Run tests\r\nPrefer concise answers\r\n');
    const result = await runImport('', ['--from', format, file]);

    expect(result.status).toBe(0);
    expect(received).toEqual(['Use TypeScript', 'Use pnpm', 'Run tests', 'Prefer concise answers'].map((content) => ({
      content, type: 'semantic', source: 'import', tags: [`import:${format}`],
    })));
    expect(requests).toEqual([{ method: 'POST', url: '/api/memory/batch', size: 4 }]);
  });

  it.each([
    ['strings', ['Use TypeScript', 'Use pnpm'], ['Use TypeScript', 'Use pnpm']],
    ['objects', [{ content: 'Use TypeScript' }, { memory: 'Use pnpm' }, { text: 'Run tests' }],
      ['Use TypeScript', 'Use pnpm', 'Run tests']],
  ])('imports ChatGPT JSON arrays of %s', async (_label, entries, expected) => {
    const file = fixture('chatgpt.json', JSON.stringify(entries));
    const result = await runImport('', ['--from', 'chatgpt', file]);

    expect(result.status).toBe(0);
    expect(received.map((record) => record.content)).toEqual(expected);
    expect(received.every((record) => record.type === 'semantic'
      && JSON.stringify(record.tags) === '["import:chatgpt"]')).toBe(true);
  });

  it.each(['markdown', 'chatgpt', 'claude'])('previews %s without posting', async (format) => {
    const file = fixture('facts.md', '- Use TypeScript\n- Use pnpm');
    const result = await runImport('', ['--from', format, file, '--dry-run']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Found 2 memories to import');
    expect(result.stdout).toContain('Dry run — no changes.');
    expect(requests).toEqual([]);
  });

  it('splits requests at the batch route limit', async () => {
    const file = fixture('facts.txt', Array.from({ length: 1001 }, (_, i) => `Fact ${i}`).join('\n'));
    const result = await runImport('', ['--from', 'claude', file]);

    expect(result.status).toBe(0);
    expect(requests.map((request) => request.size)).toEqual([1000, 1]);
    expect(result.stdout).toContain('Imported: 1001  Skipped: 0');
  });

  it('counts rejected batches and reports the first API failure', async () => {
    responseStatus = 500;
    const file = fixture('facts.txt', 'One\nTwo');
    const result = await runImport('', ['--from', 'claude', file]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Imported: 0  Skipped: 2');
    expect(result.stdout).toContain('First failure: API 500: /api/memory/batch');
  });

  it('imports valid ChatGPT JSON records while counting invalid entries', async () => {
    const file = fixture('facts.json', JSON.stringify(['Good', null, {}, { content: 12 }, '']));
    const result = await runImport('', ['--from', 'chatgpt', file]);

    expect(result.status).toBe(1);
    expect(received).toHaveLength(1);
    expect(result.stdout).toContain('Imported: 1  Skipped: 4');
  });

  it('reports malformed ChatGPT JSON without posting', async () => {
    const file = fixture('facts.json', '["broken"');
    const result = await runImport('', ['--from', 'chatgpt', file]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Error:');
    expect(requests).toEqual([]);
  });

  it.each([
    [['--from', 'unknown'], 'Unknown import format'],
    [['--from', 'markdown'], 'A path is required'],
  ])('rejects invalid arguments %s', async (args, message) => {
    const result = await runImport('', args);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(requests).toEqual([]);
  });
});
