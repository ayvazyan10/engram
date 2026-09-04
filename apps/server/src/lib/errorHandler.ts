import { STATUS_CODES } from 'http';
import type { FastifyError, FastifyInstance } from 'fastify';

/**
 * The generic 5xx body. Deliberately says nothing about the failure.
 */
const INTERNAL_MESSAGE = 'An internal error occurred. See the server log for details.';

/**
 * Install the application-wide error handler.
 *
 * Fastify 5 installs no handler of its own, so an uncaught throw fell through
 * to the framework's fallback serializer — which returns `error.message` and
 * `error.code` for a 500 as happily as for a 400. That is how a duplicate
 * POST /api/connections answered with
 * "UNIQUE constraint failed: memory_connections.source_id, ..." and how a
 * failing index write answered with an absolute path under the user's home
 * directory: the caller learned the schema, the storage engine and the
 * server's filesystem layout from an error they triggered on purpose.
 *
 * 4xx bodies are kept as-is. Those messages are produced by schema validation
 * and by route handlers, describe the caller's OWN input ("body must have
 * required property 'content'"), and are the only way a client can tell what
 * to fix. Only 5xx — the class that carries internal state — is replaced.
 */
export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const declared = err.statusCode;
    const statusCode =
      typeof declared === 'number' && declared >= 400 && declared <= 599 ? declared : 500;

    if (statusCode < 500) {
      reply.code(statusCode).send({
        statusCode,
        error: STATUS_CODES[statusCode] ?? 'Error',
        message: err.message,
      });
      return;
    }

    // Log everything the response no longer carries, so the detail is not lost
    // — only moved to where the operator, and not the caller, can read it.
    req.log.error({ err, method: req.method, url: req.url }, 'request failed');

    reply.code(statusCode).send({
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Internal Server Error',
      message: INTERNAL_MESSAGE,
    });
  });
}
