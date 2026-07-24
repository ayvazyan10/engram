/**
 * Upstream response parsing for both Ollama-native (NDJSON) and
 * OpenAI-compatible (SSE) formats.
 */

export interface ParsedResponse {
  text: string;
  hasToolCalls: boolean;
  finishReason: string;
}

/**
 * Parse an Ollama /api/chat or /api/generate response.
 *
 * These endpoints default to stream:true and emit newline-delimited JSON where
 * the terminal {done:true} chunk carries EMPTY content — so the text must be
 * aggregated across every chunk, not read off the last line.
 */
export function parseOllamaResponse(body: string): ParsedResponse {
  const lines = body.split('\n').filter(Boolean);
  if (lines.length === 0) return { text: '', hasToolCalls: false, finishReason: '' };

  let text = '';
  let hasToolCalls = false;
  let finishReason = '';

  for (const line of lines) {
    try {
      const d = JSON.parse(line) as {
        response?: string;
        message?: { content?: string; tool_calls?: unknown[] };
        done?: boolean;
      };
      text += d.response ?? d.message?.content ?? '';
      if (d.message?.tool_calls?.length) hasToolCalls = true;
      if (d.done) finishReason = 'stop';
    } catch {
      // Not JSON (or a partial chunk) — skip this line.
    }
  }

  return { text, hasToolCalls, finishReason };
}

/** Parse an OpenAI-compatible /v1/chat/completions response (SSE or plain JSON). */
export function parseOpenAIResponse(body: string): ParsedResponse {
  // Streaming SSE: lines starting with "data: "
  const sseLines = body.split('\n').filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]');

  if (sseLines.length > 0) {
    let text = '';
    let finishReason = '';
    let hasToolCalls = false;

    for (const line of sseLines) {
      try {
        const chunk = JSON.parse(line.slice(6)) as {
          choices?: Array<{
            delta?: { content?: string; tool_calls?: unknown[] };
            finish_reason?: string | null;
          }>;
        };
        const choice = chunk.choices?.[0];
        if (choice?.delta?.content) text += choice.delta.content;
        if (choice?.delta?.tool_calls?.length) hasToolCalls = true;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
      } catch { /* partial chunk */ }
    }

    return { text, hasToolCalls, finishReason };
  }

  // Non-streaming JSON
  try {
    const data = JSON.parse(body) as {
      choices?: Array<{
        message?: { content?: string; tool_calls?: unknown[] };
        finish_reason?: string;
      }>;
    };
    const choice = data.choices?.[0];
    return {
      text: choice?.message?.content ?? '',
      hasToolCalls: !!choice?.message?.tool_calls?.length,
      finishReason: choice?.finish_reason ?? '',
    };
  } catch {
    return { text: '', hasToolCalls: false, finishReason: '' };
  }
}
