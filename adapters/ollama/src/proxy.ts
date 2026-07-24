#!/usr/bin/env node
/**
 * Engram × Ollama Transparent Proxy
 *
 * Intercepts both Ollama native (/api/chat, /api/generate) and
 * OpenAI-compatible (/v1/chat/completions) requests.
 *
 * Features:
 *   - Injects Engram memory context into every chat request
 *   - Stores AI responses as episodic memories
 *   - Retries failed tool calls once with an explicit instruction
 *
 * Environment:
 *   OLLAMA_PROXY_PORT=11435       (default: 11435)
 *   OLLAMA_TARGET=http://localhost:11434
 *   ENGRAM_API=http://localhost:4901
 *   ENGRAM_MAX_TOKENS=1500
 *   ENGRAM_TOOL_RETRY=true        (set to "false" to disable retry)
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';

const PROXY_PORT = parseInt(process.env['OLLAMA_PROXY_PORT'] ?? '11435', 10);
const OLLAMA_TARGET = process.env['OLLAMA_TARGET'] ?? 'http://localhost:11434';
const ENGRAM_API = process.env['ENGRAM_API'] ?? 'http://localhost:4901';
const MAX_TOKENS = parseInt(process.env['ENGRAM_MAX_TOKENS'] ?? '1500', 10);
const TOOL_RETRY = process.env['ENGRAM_TOOL_RETRY'] !== 'false';
/** Abort an upstream request that never responds, so sockets are not held forever. */
const UPSTREAM_TIMEOUT_MS = parseInt(process.env['ENGRAM_UPSTREAM_TIMEOUT_MS'] ?? '300000', 10);

/**
 * Headers never forwarded upstream: `host`/`content-length` are recomputed, the
 * hop-by-hop set is per-connection and must not be proxied, and `accept-encoding`
 * is dropped so responses stay parseable for auto-store.
 */
const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'upgrade',
  'accept-encoding',
]);

// ─── Engram API ───────────────────────────────────────────────────────────────

async function recallContext(query: string): Promise<string> {
  try {
    const response = await fetch(`${ENGRAM_API}/api/recall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, maxTokens: MAX_TOKENS, source: 'ollama' }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return '';
    const data = await response.json() as { context?: string };
    return data.context ?? '';
  } catch {
    return '';
  }
}

async function storeMemory(content: string, source: string = 'ollama'): Promise<void> {
  try {
    await fetch(`${ENGRAM_API}/api/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, type: 'episodic', source }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // fire-and-forget — never block the response
  }
}

// ─── Request helpers ──────────────────────────────────────────────────────────

type MessageContent = string | Array<{ type: string; text?: string }>;

function extractUserQuery(body: Record<string, unknown>): string {
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

function injectContext(body: Record<string, unknown>, context: string): Record<string, unknown> {
  if (!context) return body;

  if (Array.isArray(body['messages'])) {
    const messages = body['messages'] as Array<{ role: string; content: MessageContent }>;
    const sysIdx = messages.findIndex((m) => m.role === 'system');

    if (sysIdx >= 0) {
      const system = messages[sysIdx]!;
      // Only string content can be concatenated. Multimodal content is an array
      // of parts; templating it produced the literal "[object Object]".
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
            i === sysIdx ? { ...m, content: [...(m.content as Array<{ type: string; text?: string }>), { type: 'text', text: context }] } : m
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

// ─── Path classification ──────────────────────────────────────────────────────

function isChatPath(url: string): boolean {
  return (
    url.startsWith('/api/chat') ||
    url.startsWith('/api/generate') ||
    url.startsWith('/v1/chat/completions')
  );
}

function isOpenAIPath(url: string): boolean {
  return url.startsWith('/v1/');
}

// ─── Response parsing ─────────────────────────────────────────────────────────

interface ParsedResponse {
  text: string;
  hasToolCalls: boolean;
  finishReason: string;
}

function parseOllamaResponse(body: string): ParsedResponse {
  // /api/chat and /api/generate default to stream:true and emit newline-delimited
  // JSON, where the terminal {done:true} chunk carries EMPTY content. Reading only
  // the last line therefore produced an empty text on the default path, so the
  // "store AI responses as memories" feature silently never fired. Aggregate
  // across every chunk instead (mirrors parseOpenAIResponse).
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

function parseOpenAIResponse(body: string): ParsedResponse {
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
    const d = JSON.parse(body) as {
      choices?: Array<{
        message?: { content?: string; tool_calls?: unknown[] };
        finish_reason?: string;
      }>;
    };
    const choice = d.choices?.[0];
    return {
      text: choice?.message?.content ?? '',
      hasToolCalls: !!(choice?.message?.tool_calls?.length),
      finishReason: choice?.finish_reason ?? '',
    };
  } catch {
    return { text: '', hasToolCalls: false, finishReason: '' };
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

const targetUrl = new URL(OLLAMA_TARGET);

function makeBufferedRequest(
  path: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: targetUrl.hostname,
      port: parseInt(targetUrl.port) || 11434,
      path,
      method,
      headers: { ...headers, 'content-length': body.length.toString(), host: targetUrl.host },
    };
    const proto = targetUrl.protocol === 'https:' ? https : http;
    const req = proto.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      // The response stream had no 'error' listener: a mid-response socket reset
      // emitted an unhandled 'error' and crashed the proxy.
      res.on('error', reject);
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 200, headers: res.headers, body: Buffer.concat(chunks) })
      );
    });
    req.on('error', reject);
    // Without a timeout a hung upstream kept the socket and this promise alive forever.
    req.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      req.destroy(new Error(`Upstream timed out after ${UPSTREAM_TIMEOUT_MS}ms`));
    });
    req.write(body);
    req.end();
  });
}

function streamRequest(
  path: string,
  method: string,
  reqHeaders: Record<string, string>,
  body: Buffer,
  res: http.ServerResponse
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: targetUrl.hostname,
      port: parseInt(targetUrl.port) || 11434,
      path,
      method,
      headers: { ...reqHeaders, 'content-length': body.length.toString(), host: targetUrl.host },
    };
    const proto = targetUrl.protocol === 'https:' ? https : http;

    // On failure the client MUST be answered here — the caller cannot, because
    // headers may already be sent. Previously nothing was written and the
    // client hung until its own timeout.
    const failClient = (err: Error) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway');
      } else if (!res.writableEnded) {
        res.end();
      }
      reject(err);
    };

    const req = proto.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
      const chunks: Buffer[] = [];
      proxyRes.on('data', (c: Buffer) => { chunks.push(c); res.write(c); });
      proxyRes.on('error', failClient);
      proxyRes.on('end', () => { res.end(); resolve(Buffer.concat(chunks)); });
    });

    req.on('error', failClient);
    req.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      req.destroy(new Error(`Upstream timed out after ${UPSTREAM_TIMEOUT_MS}ms`));
    });

    // Client went away — release the upstream instead of streaming into a dead socket.
    res.on('close', () => {
      if (!res.writableEnded) req.destroy();
    });

    req.write(body);
    req.end();
  });
}

function passthrough(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: Buffer
): void {
  const options: http.RequestOptions = {
    hostname: targetUrl.hostname,
    port: parseInt(targetUrl.port) || 11434,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: targetUrl.host },
  };
  const proto = targetUrl.protocol === 'https:' ? https : http;
  const proxyReq = proto.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', () => { res.writeHead(502); res.end('Bad Gateway'); });
  proxyReq.write(body);
  proxyReq.end();
}

// ─── Tool-call retry ──────────────────────────────────────────────────────────

function buildRetryBody(
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

// ─── Main proxy handler ───────────────────────────────────────────────────────

const proxy = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', async () => {
    const rawBody = Buffer.concat(chunks);
    const url = req.url ?? '/';

    if (!isChatPath(url) || rawBody.length === 0) {
      return passthrough(req, res, rawBody);
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString()) as Record<string, unknown>;
    } catch {
      return passthrough(req, res, rawBody);
    }

    const openai = isOpenAIPath(url);
    const userQuery = extractUserQuery(body);
    const hasTools =
      Array.isArray(body['tools']) && (body['tools'] as unknown[]).length > 0;

    // Inject memory context
    if (userQuery) {
      const context = await recallContext(userQuery);
      if (context) {
        body = injectContext(body, context);
        console.info(`[Engram] Injected ${context.length} chars of context (${openai ? 'openai' : 'ollama'})`);
      }
    }

    // Strip headers that will be recalculated, plus all hop-by-hop headers.
    // Forwarding the client's transfer-encoding alongside our recomputed
    // content-length produced a request with BOTH framings — invalid per
    // RFC 7230, a request-smuggling shape, and rejected by strict upstreams.
    // accept-encoding is dropped too so responses stay plaintext and the
    // auto-store parser can read them.
    const forwardHeaders = Object.fromEntries(
      Object.entries(req.headers)
        .filter(([k]) => !STRIPPED_REQUEST_HEADERS.has(k.toLowerCase()))
        .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v ?? '')])
    );

    // ── Tool-call requests: buffer + retry on failure ──────────────────────
    if (hasTools && TOOL_RETRY) {
      const bodyBuf = Buffer.from(JSON.stringify(body));

      const first = await makeBufferedRequest(url, req.method ?? 'POST', forwardHeaders, bodyBuf).catch(
        () => null
      );
      if (!first) { res.writeHead(502); res.end('Bad Gateway'); return; }

      const parsed = openai
        ? parseOpenAIResponse(first.body.toString())
        : parseOllamaResponse(first.body.toString());

      // Model responded with text instead of a tool call — retry once
      if (!parsed.hasToolCalls && parsed.finishReason !== 'tool_calls' && parsed.text) {
        console.info(`[Engram] Tool call missed — retrying with instruction`);
        const retryBody = buildRetryBody(body, parsed.text);
        const retryBuf = Buffer.from(JSON.stringify(retryBody));
        const second = await makeBufferedRequest(
          url, req.method ?? 'POST', forwardHeaders, retryBuf
        ).catch(() => null);

        if (second) {
          res.writeHead(second.status, second.headers);
          res.end(second.body);
          const retryParsed = openai
            ? parseOpenAIResponse(second.body.toString())
            : parseOllamaResponse(second.body.toString());
          if (userQuery && retryParsed.text) {
            void storeMemory(
              `User: ${userQuery}\nAssistant: ${retryParsed.text.slice(0, 1000)}`,
              'ollama-retry'
            );
          }
          return;
        }
      }

      // Tool call succeeded — forward first response
      res.writeHead(first.status, first.headers);
      res.end(first.body);
      if (userQuery && parsed.text) {
        void storeMemory(`User: ${userQuery}\nAssistant: ${parsed.text.slice(0, 1000)}`, 'ollama');
      }
      return;
    }

    // ── No tools: stream directly ──────────────────────────────────────────
    const bodyBuf = Buffer.from(JSON.stringify(body));
    const responseBody = await streamRequest(url, req.method ?? 'POST', forwardHeaders, bodyBuf, res).catch(
      () => null
    );

    if (!responseBody) return; // error already written by streamRequest

    const parsed = openai
      ? parseOpenAIResponse(responseBody.toString())
      : parseOllamaResponse(responseBody.toString());

    if (userQuery && parsed.text) {
      void storeMemory(`User: ${userQuery}\nAssistant: ${parsed.text.slice(0, 1000)}`, 'ollama');
    }
  });
});

proxy.on('error', (err) => console.error('[Engram] Server error:', err.message));

proxy.listen(PROXY_PORT, () => {
  console.info(`Engram × Ollama Proxy`);
  console.info(`  Listening:    http://localhost:${PROXY_PORT}`);
  console.info(`  Ollama target: ${OLLAMA_TARGET}`);
  console.info(`  Engram:   ${ENGRAM_API}`);
  console.info(`  Tool retry:    ${TOOL_RETRY ? 'enabled' : 'disabled'}`);
  console.info('');
  console.info('Intercepts: /api/chat  /api/generate  /v1/chat/completions');
});
