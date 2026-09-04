import type { preValidationHookHandler } from 'fastify';

/**
 * Reject unknown keys and mistyped containers BEFORE schema validation.
 *
 * `additionalProperties: false` alone does not do this here. Fastify's ajv
 * runs with `removeAdditional`, so an unknown key is stripped in silence and
 * the caller gets a 200 for an update that never happened — the same reason
 * PUT /api/decay/policy refuses `protectionRules` in a preValidation hook
 * rather than in its schema.
 *
 * `arrayFields` covers the other half. Fastify's ajv also runs with
 * `coerceTypes: 'array'`, which wraps a scalar into a single-element array. It
 * is the right default for query strings, but on a body it turns
 * `{"ids":"abc"}` into `{"ids":["abc"]}` and answers 200 for a request that
 * was plainly a mistake.
 *
 * @param allowed     keys the body may contain
 * @param arrayFields keys that must already be arrays, not coercible scalars
 */
export function strictObjectBody(
  allowed: readonly string[],
  arrayFields: readonly string[] = []
): preValidationHookHandler {
  const permitted = new Set(allowed);

  return async (req, reply) => {
    const body = req.body;

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Request body must be a JSON object.',
      });
    }

    const unknown = Object.keys(body).filter((key) => !permitted.has(key));
    if (unknown.length > 0) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: `Unknown propert${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}.`,
      });
    }

    for (const field of arrayFields) {
      const value = (body as Record<string, unknown>)[field];
      if (value !== undefined && !Array.isArray(value)) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: `'${field}' must be an array.`,
        });
      }
    }

    return undefined;
  };
}

/**
 * Reject unknown query-string parameters BEFORE schema validation.
 *
 * Exactly the trap `strictObjectBody` exists for, on the other half of the
 * request: `additionalProperties: false` in a querystring schema does not
 * refuse an unknown key, because Fastify's ajv runs with `removeAdditional`
 * and strips it in silence. `GET /api/analytics?day=90` — one letter short of
 * `days` — was therefore answered 200 with a 30-day window that the caller
 * read as 90 days. A wrong number nobody was told about is worse than an
 * error, so it is an error.
 *
 * The schema keeps `additionalProperties: false` anyway: it documents the
 * contract and is what OpenAPI publishes. This hook is what enforces it.
 *
 * @param allowed parameter names the route accepts
 */
export function strictQueryString(allowed: readonly string[]): preValidationHookHandler {
  const permitted = new Set(allowed);

  return async (req, reply) => {
    const query = req.query;
    if (typeof query !== 'object' || query === null) return undefined;

    const unknown = Object.keys(query).filter((key) => !permitted.has(key));
    if (unknown.length > 0) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: `Unknown query parameter${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}.`,
      });
    }

    return undefined;
  };
}
