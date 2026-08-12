import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema } from '@engram-ai-memory/core';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { brain } from '../index.js';

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
        const depth = req.query.depth ?? 2;

        // Get the root node
        const [rootMemory] = await db
          .select()
          .from(schema.memories)
          .where(eq(schema.memories.id, id))
          .limit(1);

        if (!rootMemory || !brain.canAccessNamespace(rootMemory.namespace)) {
          reply.code(404);
          return { error: 'Memory not found' };
        }

        // BFS to the requested depth. The previous implementation validated
        // `depth` but never read it (always depth 1) and matched only edges
        // where the node was the SOURCE — bidirectional edges are persisted as a
        // single row, so every inbound connection (including auto-links) was
        // invisible.
        const visited = new Set<string>([id]);
        const collected = new Map<string, typeof schema.memoryConnections.$inferSelect>();
        let frontier: string[] = [id];

        for (let level = 0; level < depth && frontier.length > 0; level++) {
          const edges = await db
            .select()
            .from(schema.memoryConnections)
            .where(
              or(
                inArray(schema.memoryConnections.sourceId, frontier),
                inArray(schema.memoryConnections.targetId, frontier)
              )
            );

          const next: string[] = [];
          for (const edge of edges) {
            collected.set(edge.id, edge);
            for (const endpoint of [edge.sourceId, edge.targetId]) {
              if (!visited.has(endpoint)) {
                visited.add(endpoint);
                next.push(endpoint);
              }
            }
          }
          frontier = next;
        }

        // One query for all neighbours instead of one per edge.
        const neighborIds = [...visited].filter((v) => v !== id);
        const neighbors = neighborIds.length
          ? await db
              .select()
              .from(schema.memories)
              .where(and(inArray(schema.memories.id, neighborIds), isNull(schema.memories.archivedAt)))
          : [];
        const visibleNeighbors = neighbors.filter((memory) => brain.canAccessNamespace(memory.namespace));
        const visibleIds = new Set([id, ...visibleNeighbors.map((memory) => memory.id)]);

        return {
          node: rootMemory,
          connections: [...collected.values()].filter((c) =>
            visibleIds.has(c.sourceId) && visibleIds.has(c.targetId)
          ).map((c) => ({
            id: c.id,
            // sourceId is part of the documented response shape and the web
            // client's type; it was previously omitted.
            sourceId: c.sourceId,
            targetId: c.targetId,
            relationship: c.relationship,
            strength: c.strength,
          })),
          neighbors: visibleNeighbors,
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

      // Dedupe first: a self-connection names the same id twice, and matching
      // the row count against a literal 2 rejected it as a missing memory.
      const endpointIds = [...new Set([req.body.sourceId, req.body.targetId])];
      const endpoints = await db.select({ id: schema.memories.id, namespace: schema.memories.namespace })
        .from(schema.memories)
        .where(inArray(schema.memories.id, endpointIds));
      if (
        endpoints.length !== endpointIds.length ||
        endpoints.some((memory) => !brain.canAccessNamespace(memory.namespace))
      ) {
        reply.code(404);
        return { error: 'Memory not found' };
      }

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

      // Mirror into the in-memory graph. Recall traverses that graph, and it is
      // only loaded once at startup — a DB-only insert was invisible to recall
      // for the entire process lifetime even though GET /graph/:id showed it.
      brain.getGraph().addEdge({
        sourceId: connection.sourceId,
        targetId: connection.targetId,
        relationship: connection.relationship,
        strength: connection.strength,
        bidirectional: connection.bidirectional,
      });

      reply.code(201);
      return connection;
    },
  });
};
