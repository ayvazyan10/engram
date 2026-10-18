import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from '@engram-ai-memory/mcp/dist/tools.js';
import { brain, notifySyncWrite, VERSION } from '../index.js';

async function handleMcpRequest(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const server = new McpServer({ name: 'engram', version: VERSION });
  // buildApp's caller initializes this brain, exactly as for REST routes.
  registerTools(server, brain, async () => {}, { notifyWrite: notifySyncWrite });
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
