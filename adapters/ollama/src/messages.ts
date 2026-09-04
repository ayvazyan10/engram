/**
 * Chat-message helpers: extracting the user query, injecting memory context,
 * and building the tool-call retry body.
 *
 * Kept free of I/O so the proxy's request-shaping logic is unit-testable.
 */

export type MessageContent = string | Array<{ type: string; text?: string }>;

/** Outcome of structural validation: either a usable body, or why it is not one. */
export type ChatBodyValidation =
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Describe what is wrong with one message entry, or null when it is usable. */
function messageProblem(entry: unknown, index: number): string | null {
  if (!isPlainObject(entry)) return `messages[${index}] is not an object`;
  if (typeof entry['role'] !== 'string') return `messages[${index}].role is not a string`;

  const content = entry['content'];
  // Absent or null content is legitimate: OpenAI assistant messages that carry
  // only tool_calls have `content: null`.
  if (content === undefined || content === null || typeof content === 'string') return null;
  if (!Array.isArray(content)) return `messages[${index}].content is neither a string nor an array`;

  for (const [i, part] of content.entries()) {
    if (!isPlainObject(part)) return `messages[${index}].content[${i}] is not an object`;
    const text = part['text'];
    if (text !== undefined && typeof text !== 'string') {
      return `messages[${index}].content[${i}].text is not a string`;
    }
  }
  return null;
}

/**
 * Check that a decoded request body is shaped like a chat request.
 *
 * `JSON.parse` happily returns `null`, a string or a number, and casting any of
 * those to `Record<string, unknown>` only postpones the failure to the first
 * dereference — which happens inside an async handler, where a TypeError is
 * fatal to the process. This is the gate that turns "attacker kills the proxy"
 * into a 400: nothing downstream reads a body that has not passed through here.
 */
export function validateChatBody(value: unknown): ChatBodyValidation {
  if (!isPlainObject(value)) return { ok: false, reason: 'body is not a JSON object' };

  const messages = value['messages'];
  if (messages !== undefined) {
    if (!Array.isArray(messages)) return { ok: false, reason: 'messages is not an array' };
    for (const [i, entry] of messages.entries()) {
      const problem = messageProblem(entry, i);
      if (problem) return { ok: false, reason: problem };
    }
  }

  const prompt = value['prompt'];
  if (prompt !== undefined && prompt !== null && typeof prompt !== 'string') {
    return { ok: false, reason: 'prompt is not a string' };
  }

  return { ok: true, body: value };
}

/**
 * The most recent user message, flattened to plain text.
 *
 * Callers must pass a body that has cleared `validateChatBody` — the casts
 * below are only sound because of it.
 */
export function extractUserQuery(body: Record<string, unknown>): string {
  if (Array.isArray(body['messages'])) {
    const messages = body['messages'] as Array<{ role: string; content: MessageContent }>;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return '';
    const c = lastUser.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map((p) => p.text ?? '').join(' ');
    return '';
  }
  return (body['prompt'] as string) ?? '';
}

/**
 * Add recalled memory context to the request.
 *
 * Appends to an existing system message when there is one, otherwise prepends a
 * new one. Multimodal (array) system content gets an extra text part rather than
 * being template-stringified into "[object Object]".
 */
export function injectContext(
  body: Record<string, unknown>,
  context: string
): Record<string, unknown> {
  if (!context) return body;

  if (Array.isArray(body['messages'])) {
    const messages = body['messages'] as Array<{ role: string; content: MessageContent }>;
    const sysIdx = messages.findIndex((m) => m.role === 'system');

    if (sysIdx >= 0) {
      const system = messages[sysIdx]!;

      if (typeof system.content === 'string') {
        return {
          ...body,
          messages: messages.map((m, i) =>
            i === sysIdx ? { ...m, content: `${m.content as string}\n\n${context}` } : m
          ),
        };
      }

      if (Array.isArray(system.content)) {
        return {
          ...body,
          messages: messages.map((m, i) =>
            i === sysIdx
              ? {
                  ...m,
                  content: [
                    ...(m.content as Array<{ type: string; text?: string }>),
                    { type: 'text', text: context },
                  ],
                }
              : m
          ),
        };
      }
    }

    return {
      ...body,
      messages: [{ role: 'system', content: context }, ...messages],
    };
  }

  // /api/generate format
  const existing = (body['system'] as string) ?? '';
  return { ...body, system: existing ? `${existing}\n\n${context}` : context };
}

/** Re-ask the model for a tool call after it replied with plain text. */
export function buildRetryBody(
  original: Record<string, unknown>,
  assistantText: string
): Record<string, unknown> {
  const messages = (original['messages'] as Array<Record<string, unknown>>) ?? [];
  return {
    ...original,
    messages: [
      ...messages,
      { role: 'assistant', content: assistantText },
      {
        role: 'user',
        content:
          'You must call one of the provided tools. Do not respond with plain text. ' +
          'Respond ONLY with a tool call using the exact tool names and parameter schemas defined above.',
      },
    ],
  };
}
