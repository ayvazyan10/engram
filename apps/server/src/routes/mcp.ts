import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { UnsafeWebhookUrlError } from '@engram-ai-memory/core';
import { registerTools } from '@engram-ai-memory/mcp/dist/tools.js';
import { brain, notifySyncWrite, VERSION } from '../index.js';
import { OperationInProgressError, runExclusive } from '../lib/exclusive.js';
import { isMemoryNotFound } from '../lib/notFound.js';

function isCallerError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return isMemoryNotFound(err) || err instanceof OperationInProgressError || err instanceof UnsafeWebhookUrlError
    || err.message.startsWith('Invalid decay policy:') || /^Memory .* has no embedding$/s.test(err.message)
    || [
      'Memory not found', 'Contradiction candidate not found', 'Pending session not found in your scope',
      'strategy requires verdict contradiction', 'namespace override is not allowed in isolated mode',
      'cross-namespace access is not allowed in isolated mode',
      'Fact was not retained separately from the raw session; session remains pending',
    ].includes(err.message);
}

async function handleMcpRequest(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const server = new McpServer({ name: 'engram', version: VERSION });
  // The SDK turns thrown messages into tool results before Fastify sees them.
  // Every tool() overload takes the callback last, after its schema and metadata.
  const register = server.tool;
  server.tool = (name: string, ...args: unknown[]): RegisteredTool => {
    const handler = args.pop() as (...input: unknown[]) => Promise<CallToolResult>;
    const guarded = async (...input: unknown[]): Promise<CallToolResult> => {
      try {
        return await handler(...input);
      } catch (err) {
        if (isCallerError(err)) throw err;
        req.log.error({ err, tool: name }, 'MCP tool failed');
        throw new Error('Tool failed. See the server log for details.');
      }
    };
    return Reflect.apply(register, server, [name, ...args, guarded]);
  };
  // buildApp's caller initializes this brain, exactly as for REST routes.
  registerTools(server, brain, async () => {}, { notifyWrite: notifySyncWrite }, {
    runDecaySweep: (dryRun) => runExclusive('consolidate', () => brain.runDecaySweep(dryRun)),
    reEmbed: (onlyStale, batchSize) => runExclusive('re-embed', () => brain.reEmbed(onlyStale, batchSize)),
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  reply.raw.once('close', () => {
    void server.close().catch(() => req.log.error('MCP transport close failed'));
  });
  try {
    await server.connect(transport);
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) reply.raw.setHeader(name, value);
    }
    reply.hijack();
    await transport.handleRequest(req.raw, reply.raw, req.body);
  } catch {
    req.log.error('MCP HTTP request failed');
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
      reply.raw.end(JSON.stringify({
        jsonrpc: '2.0', id: null,
        error: { code: -32603, message: 'Internal server error' },
      }));
    } else {
      reply.raw.end();
    }
    await server.close().catch(() => req.log.error('MCP transport close failed'));
  }
}

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  app.post('/mcp', handleMcpRequest);
  // Stateless mode has no standalone event stream or session to delete.
  app.route({
    method: ['GET', 'DELETE'], url: '/mcp',
    handler: async (_req, reply) => reply.code(405).header('Allow', 'POST').send({
      jsonrpc: '2.0', id: null,
      error: { code: -32000, message: 'Method not allowed' },
    }),
  });
}
