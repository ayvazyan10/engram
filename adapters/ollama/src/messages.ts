/**
 * Chat-message helpers: extracting the user query, injecting memory context,
 * and building the tool-call retry body.
 *
 * Kept free of I/O so the proxy's request-shaping logic is unit-testable.
 */

export type MessageContent = string | Array<{ type: string; text?: string }>;

/** The most recent user message, flattened to plain text. */
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
