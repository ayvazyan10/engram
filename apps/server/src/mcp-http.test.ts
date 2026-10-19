import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import path from 'path';
import os from 'os';
import { cleanupTestDb } from './test-helpers/cleanupTestDb.js';

const dbPath = path.join(os.tmpdir(), `engram-mcp-http-${process.pid}.db`);
const protocolVersion = '2025-03-26';
const headers = {
  accept: 'application/json, text/event-stream',
  'mcp-protocol-version': protocolVersion,
};
const initialize = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion, capabilities: {}, clientInfo: { name: 'http-test', version: '1.0.0' } },
};
let app: FastifyInstance | undefined;
let brain: typeof import('./index.js')['brain'] | undefined;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('ENGRAM_DB_PATH', dbPath);
  vi.stubEnv('ENGRAM_DECAY_INTERVAL', '0');
  vi.stubEnv('ENGRAM_API_KEY', undefined);
});

afterEach(async () => {
  await app?.close();
  brain?.shutdown();
  app = undefined;
  brain = undefined;
  cleanupTestDb(dbPath);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function startApp(): Promise<FastifyInstance> {
  const mod = await import('./index.js');
  brain = mod.brain;
  await brain.initialize();
  app = await mod.buildApp();
  await app.ready();
  return app;
}

async function handshake(server: FastifyInstance): Promise<void> {
  const response = await server.inject({ method: 'POST', url: '/mcp', headers, payload: initialize });
  expect(response.statusCode).toBe(200);
  expect(response.json().result.protocolVersion).toBe(protocolVersion);
  expect(response.headers['mcp-session-id']).toBeUndefined();
  const notification = await server.inject({
    method: 'POST', url: '/mcp', headers,
    payload: { jsonrpc: '2.0', method: 'notifications/initialized' },
  });
  expect(notification.statusCode).toBe(202);
}

async function callTool(server: FastifyInstance, name: string, args: Record<string, unknown>) {
  const response = await server.inject({
    method: 'POST', url: '/mcp', headers,
    payload: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
  });
  expect(response.statusCode).toBe(200);
  const body = response.json<{ result: { content: Array<{ type: string; text: string }>; isError?: boolean } }>();
  expect(body.result.isError).not.toBe(true);
  return body.result.content.map((item) => item.text).join('\n');
}

describe('Streamable HTTP MCP', () => {
  it('initializes and lists the shared tools without a key', async () => {
    const server = await startApp();
    await handshake(server);
    const response = await server.inject({
      method: 'POST', url: '/mcp', headers,
      payload: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    });
    expect(response.statusCode).toBe(200);
    const names = response.json<{ result: { tools: Array<{ name: string }> } }>()
      .result.tools.map((tool) => tool.name);
    expect(names).toContain('store_memory');
    expect(names).toContain('recall_context');
  });

  it('stores and recalls a memory in the REST server brain', async () => {
    // Keep this transport test offline; storage, indexing and recall remain real.
    // Core is built CommonJS, so spy on the module its internal require() uses.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be the CJS instance core uses
    const embedder = require(path.join(path.dirname(require.resolve('@engram-ai-memory/core')),
      'embedding/Embedder.js')) as typeof import('../../../packages/core/dist/embedding/Embedder.js');
    vi.spyOn(embedder, 'embed').mockImplementation(async () =>
      new Float32Array(384).fill(1 / Math.sqrt(384)));
    const server = await startApp();
    await handshake(server);
    const content = 'The cobalt telescope observes Saturn from the mountain observatory';
    const stored = JSON.parse(await callTool(server, 'store_memory', {
      content, type: 'semantic', importance: 0.9,
    })) as { id: string };
    const recalled = await callTool(server, 'recall_context', { query: content });
    expect(recalled).toContain(content);
    const rest = await server.inject({ method: 'GET', url: `/api/memory/${stored.id}` });
    expect(rest.statusCode).toBe(200);
    expect(rest.json().content).toBe(content);
  });

  it('gates canonical and encoded paths with the existing API key check', async () => {
    const key = 'mcp-http-test-secret';
    vi.stubEnv('ENGRAM_API_KEY', key);
    const server = await startApp();
    for (const url of ['/mcp', '/%6dcp?client=test']) {
      for (const auth of [{}, { 'x-api-key': 'wrong' }]) {
        const response = await server.inject({ method: 'POST', url,
          headers: { ...headers, ...auth }, payload: initialize });
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: 'Unauthorized' });
      }
      for (const auth of [{ 'x-api-key': key }, { authorization: `Bearer ${key}` }]) {
        const response = await server.inject({ method: 'POST', url,
          headers: { ...headers, ...auth }, payload: initialize });
        expect(response.statusCode).toBe(200);
      }
    }
    for (const method of ['GET', 'DELETE'] as const) {
      expect((await server.inject({ method, url: '/mcp' })).statusCode).toBe(401);
    }
  });

  it('enforces Host and Origin checks, including encoded paths', async () => {
    const server = await startApp();
    for (const url of ['/mcp', '/%6dcp']) {
      for (const denied of [{ host: 'attacker.example' }, { origin: 'https://attacker.example' }]) {
        const response = await server.inject({ method: 'POST', url,
          headers: { ...headers, ...denied }, payload: initialize });
        expect(response.statusCode).toBe(403);
      }
    }
    const response = await server.inject({ method: 'POST', url: '/mcp',
      headers: { ...headers, origin: 'http://localhost:5173' }, payload: initialize });
    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('closes every request transport and refuses standalone streams and session deletion', async () => {
    const close = vi.spyOn(StreamableHTTPServerTransport.prototype, 'close');
    const server = await startApp();
    await handshake(server);
    expect(close).toHaveBeenCalledTimes(2);
    for (const method of ['GET', 'DELETE'] as const) {
      const response = await server.inject({ method, url: '/mcp' });
      expect(response.statusCode).toBe(405);
      expect(response.headers['allow']).toBe('POST');
    }
  });
});
