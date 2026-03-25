import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema } from '@engram-ai-memory/core';
import { eq } from 'drizzle-orm';

export const graphRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/graph/:id — get connections for a memory node
  app.get<{ Params: { id: string }; Querystring: { depth?: number } }>(
    '/graph/:id',
    {
      schema: {
        tags: ['graph'],
        summary: 'Get knowledge graph neighborhood for a memory',
        querystring: {
          type: 'object',
          properties: {
            depth: { type: 'integer', default: 2, maximum: 4 },
          },
        },
      },
      handler: async (req, reply) => {
        const db = getDb();
        const { id } = req.params;

        // Get the root node
        const [rootMemory] = await db
          .select()
          .from(schema.memories)
          .where(eq(schema.memories.id, id))
          .limit(1);

        if (!rootMemory) {
          reply.code(404);
          return { error: 'Memory not found' };
        }

        // Get direct connections
        const connections = await db
          .select()
          .from(schema.memoryConnections)
          .where(eq(schema.memoryConnections.sourceId, id));

        // Get connected node details
        const connectedIds = connections.map((c) => c.targetId);
        const connectedNodes = [];

        for (const nodeId of connectedIds) {
          const [node] = await db
            .select()
            .from(schema.memories)
            .where(eq(schema.memories.id, nodeId))
            .limit(1);
          if (node) connectedNodes.push(node);
        }

        return {
          node: rootMemory,
          connections: connections.map((c) => ({
            id: c.id,
            targetId: c.targetId,
            relationship: c.relationship,
            strength: c.strength,
          })),
          neighbors: connectedNodes,
        };
      },
    }
  );

  // POST /api/connections — create a connection between memories
  app.post<{
    Body: {
      sourceId: string;
      targetId: string;
      relationship: string;
      strength?: number;
      bidirectional?: boolean;
    };
  }>('/connections', {
    schema: {
      tags: ['graph'],
      summary: 'Create a connection between two memories',
      body: {
        type: 'object',
        required: ['sourceId', 'targetId', 'relationship'],
        properties: {
          sourceId: { type: 'string' },
          targetId: { type: 'string' },
          relationship: {
            type: 'string',
            enum: ['is_a', 'has_property', 'causes', 'relates_to', 'contradicts', 'part_of', 'follows'],
          },
          strength: { type: 'number', minimum: 0, maximum: 1 },
          bidirectional: { type: 'boolean', default: false },
        },
      },
    },
    handler: async (req, reply) => {
      const db = getDb();
      const { v4: uuidv4 } = await import('uuid');

      const connection = {
        id: uuidv4(),
        sourceId: req.body.sourceId,
        targetId: req.body.targetId,
        relationship: req.body.relationship as 'is_a' | 'has_property' | 'causes' | 'relates_to' | 'contradicts' | 'part_of' | 'follows',
        strength: req.body.strength ?? 1.0,
        bidirectional: req.body.bidirectional ?? false,
        metadata: '{}',
        createdAt: new Date().toISOString(),
      };

      await db.insert(schema.memoryConnections).values(connection);
      reply.code(201);
      return connection;
    },
  });
};
