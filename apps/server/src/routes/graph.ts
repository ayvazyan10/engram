import type { FastifyPluginAsync } from 'fastify';
import { getDb, getDeviceId, schema, upsertConnection } from '@engram-ai-memory/core';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { brain, notifySyncWrite } from '../index.js';
import { strictQueryString } from '../lib/strictBody.js';

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
          additionalProperties: false,
          properties: {
            depth: { type: 'integer', default: 2, minimum: 1, maximum: 4 },
          },
        },
      },
      // Fastify's ajv runs with removeAdditional, so `additionalProperties: false`
      // above documents the contract without enforcing it — an unknown key is
      // stripped in silence and the caller is answered 200 for a request that was
      // plainly a typo. This is what enforces it; see lib/strictBody.ts.
      preValidation: strictQueryString(['depth']),
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
              and(
                or(
                  inArray(schema.memoryConnections.sourceId, frontier),
                  inArray(schema.memoryConnections.targetId, frontier)
                ),
                isNull(schema.memoryConnections.deletedAt)
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

      // Same createdAt/updatedAt instant on insert, matching the invariant
      // NeuralBrain's own write paths use for new rows.
      const now = new Date().toISOString();
      const connection = {
        id: uuidv4(),
        sourceId: req.body.sourceId,
        targetId: req.body.targetId,
        relationship: req.body.relationship as 'is_a' | 'has_property' | 'causes' | 'relates_to' | 'contradicts' | 'part_of' | 'follows',
        strength: req.body.strength ?? 1.0,
        bidirectional: req.body.bidirectional ?? false,
        metadata: '{}',
        createdAt: now,
        updatedAt: now,
        deviceId: getDeviceId(),
      };

      // A live duplicate is a conflict, not a server fault. Letting
      // upsertConnection throw the UNIQUE violation produced a 500 whose body
      // read "UNIQUE constraint failed: memory_connections.source_id, ..." —
      // handing the caller the table and column names for an outcome they can
      // legitimately provoke. Checked before the write rather than caught
      // after it, so the answer does not depend on the driver's error text.
      const [duplicate] = await db
        .select({ id: schema.memoryConnections.id })
        .from(schema.memoryConnections)
        .where(
          and(
            eq(schema.memoryConnections.sourceId, connection.sourceId),
            eq(schema.memoryConnections.targetId, connection.targetId),
            eq(schema.memoryConnections.relationship, connection.relationship),
            isNull(schema.memoryConnections.deletedAt)
          )
        )
        .limit(1);
      if (duplicate) {
        reply.code(409);
        return { error: 'Connection already exists' };
      }

      // upsertConnection rather than a raw insert — see
      // graph/connectionStore.ts: it resurrects a tombstoned row that
      // occupies the same (source, target, relationship) slot instead of
      // throwing the UNIQUE constraint violation a naive insert would (e.g. a
      // connection that was forgotten and is now being re-created).
      upsertConnection(db, connection);
      notifySyncWrite();

      // Re-read the persisted row rather than trusting the locally built
      // `connection` object: when upsertConnection resurrects a tombstoned
      // row, that row keeps its OWN original id — not the fresh uuid
      // generated above — so `connection.id` would otherwise be returned to
      // the caller without ever existing in the table.
      const [persisted] = await db
        .select()
        .from(schema.memoryConnections)
        .where(
          and(
            eq(schema.memoryConnections.sourceId, connection.sourceId),
            eq(schema.memoryConnections.targetId, connection.targetId),
            eq(schema.memoryConnections.relationship, connection.relationship)
          )
        )
        .limit(1);

      // Mirror into the in-memory graph. Recall traverses that graph, and it is
      // only loaded once at startup — a DB-only insert was invisible to recall
      // for the entire process lifetime even though GET /graph/:id showed it.
      brain.getGraph().addEdge({
        sourceId: persisted!.sourceId,
        targetId: persisted!.targetId,
        relationship: persisted!.relationship,
        strength: persisted!.strength,
        bidirectional: persisted!.bidirectional,
      });

      reply.code(201);
      return persisted;
    },
  });
};
