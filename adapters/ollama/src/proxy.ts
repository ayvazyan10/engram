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
 * Request shaping, response parsing and upstream I/O live in sibling modules
 * (messages / parse / headers / upstream) so they can be unit-tested; this file
 * is the wiring and the server lifecycle.
 *
 * Environment:
 *   OLLAMA_PROXY_PORT=11435       (default: 11435)
 *   ENGRAM_PROXY_HOST=127.0.0.1   (default: loopback only — see below)
 *   OLLAMA_TARGET=http://localhost:11434
 *   ENGRAM_API=http://localhost:4901
 *   ENGRAM_MAX_TOKENS=1500
 *   ENGRAM_MAX_BODY_BYTES=10485760   (10 MiB; raise for large multimodal bodies)
 *   ENGRAM_TOOL_RETRY=true        (set to "false" to disable retry)
 *   ENGRAM_UPSTREAM_TIMEOUT_MS=300000
 */

import http from 'http';
import { URL } from 'url';

import { extractUserQuery, injectContext, buildRetryBody, validateChatBody } from './messages.js';
import { parseOllamaResponse, parseOpenAIResponse } from './parse.js';
import { buildForwardHeaders, isChatPath, isOpenAIPath } from './headers.js';
import { makeBufferedRequest, streamRequest, passthrough, type UpstreamTarget } from './upstream.js';

/**
 * Loopback by default. This proxy has no authentication and drives the user's
 * GPU, and Ollama itself only listens on loopback — binding every interface
 * handed any LAN peer an open endpoint. Set ENGRAM_PROXY_HOST to widen it.
 */
const DEFAULT_LISTEN_HOST = '127.0.0.1';

/**
 * Ceiling on a buffered request body. Anything above it is refused with 413:
 * the handler reads the whole body into memory, so without a cap a single
 * client streaming an endless upload grows RSS until the process is killed.
 */
const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

const PROXY_PORT = parseInt(process.env['OLLAMA_PROXY_PORT'] ?? '11435', 10);
const LISTEN_HOST = process.env['ENGRAM_PROXY_HOST'] ?? DEFAULT_LISTEN_HOST;
const OLLAMA_TARGET = process.env['OLLAMA_TARGET'] ?? 'http://localhost:11434';
const ENGRAM_API = process.env['ENGRAM_API'] ?? 'http://localhost:4901';
const MAX_TOKENS = parseInt(process.env['ENGRAM_MAX_TOKENS'] ?? '1500', 10);
const MAX_BODY_BYTES = parseInt(
  process.env['ENGRAM_MAX_BODY_BYTES'] ?? String(DEFAULT_MAX_BODY_BYTES), 10
);
const TOOL_RETRY = process.env['ENGRAM_TOOL_RETRY'] !== 'false';
const UPSTREAM_TIMEOUT_MS = parseInt(process.env['ENGRAM_UPSTREAM_TIMEOUT_MS'] ?? '300000', 10);

const target: UpstreamTarget = {
  url: new URL(OLLAMA_TARGET),
  timeoutMs: UPSTREAM_TIMEOUT_MS,
};

/** Everything the chat handlers need once the request has been classified. */
interface ChatDispatch {
  readonly res: http.ServerResponse;
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
  readonly openai: boolean;
  readonly userQuery: string;
}

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

/** Record one exchange, if there was anything worth recording. */
function rememberExchange(userQuery: string, text: string, source: string): void {
  if (!userQuery || !text) return;
  void storeMemory(`User: ${userQuery}\nAssistant: ${text.slice(0, 1000)}`, source);
}

// ─── Request intake ───────────────────────────────────────────────────────────

type BodyRead =
  | { readonly ok: true; readonly body: Buffer }
  | { readonly ok: false; readonly reason: 'too-large' | 'interrupted' };

/**
 * Buffer the request body, refusing to grow past `limit`.
 *
 * On overflow the accumulated chunks are dropped immediately and the stream is
 * paused, so a client that keeps sending cannot keep costing us memory while
 * the 413 is written.
 */
function readLimitedBody(req: http.IncomingMessage, limit: number): Promise<BodyRead> {
  return new Promise((resolve) => {
    let chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (result: BodyRead) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        chunks = [];
        req.pause();
        settle({ ok: false, reason: 'too-large' });
        return;
      }
      chunks.push(chunk);
    });
    req.on('aborted', () => settle({ ok: false, reason: 'interrupted' }));
    req.on('error', () => settle({ ok: false, reason: 'interrupted' }));
    req.on('end', () => settle({ ok: true, body: Buffer.concat(chunks) }));
  });
}

function rejectTooLarge(req: http.IncomingMessage, res: http.ServerResponse): void {
  console.warn(`[Engram] Request body exceeded ${MAX_BODY_BYTES} bytes — rejected`);
  if (res.headersSent) return;
  res.writeHead(413, { 'Content-Type': 'text/plain', Connection: 'close' });
  // The client is likely still uploading; drop the socket once the refusal is
  // out rather than draining a body we have already decided not to read.
  res.end('Payload Too Large', () => req.socket?.destroy());
}

function rejectMalformed(res: http.ServerResponse, reason: string): void {
  console.warn(`[Engram] Rejected malformed chat request: ${reason}`);
  if (res.headersSent) return;
  const payload = JSON.stringify({ error: `Invalid chat request: ${reason}` });
  res.writeHead(400, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// ─── Chat handling ────────────────────────────────────────────────────────────

/** Enrich the body with recalled memory, or hand it back untouched. */
async function withRecalledContext(
  body: Record<string, unknown>,
  userQuery: string,
  openai: boolean
): Promise<Record<string, unknown>> {
  const context = await recallContext(userQuery);
  if (!context) return body;
  console.info(
    `[Engram] Injected ${context.length} chars of context (${openai ? 'openai' : 'ollama'})`
  );
  return injectContext(body, context);
}

/** Buffer the response so a model that answered in prose can be re-asked once. */
async function handleToolCall(d: ChatDispatch): Promise<void> {
  const parse = d.openai ? parseOpenAIResponse : parseOllamaResponse;
  const bodyBuf = Buffer.from(JSON.stringify(d.body));

  const first = await makeBufferedRequest(target, d.url, d.method, d.headers, bodyBuf)
    .catch(() => null);
  if (!first) { d.res.writeHead(502); d.res.end('Bad Gateway'); return; }

  const parsed = parse(first.body.toString());

  // Model responded with text instead of a tool call — retry once
  if (!parsed.hasToolCalls && parsed.finishReason !== 'tool_calls' && parsed.text) {
    console.info(`[Engram] Tool call missed — retrying with instruction`);
    const retryBuf = Buffer.from(JSON.stringify(buildRetryBody(d.body, parsed.text)));
    const second = await makeBufferedRequest(target, d.url, d.method, d.headers, retryBuf)
      .catch(() => null);

    if (second) {
      d.res.writeHead(second.status, second.headers);
      d.res.end(second.body);
      rememberExchange(d.userQuery, parse(second.body.toString()).text, 'ollama-retry');
      return;
    }
  }

  // Tool call succeeded — forward first response
  d.res.writeHead(first.status, first.headers);
  d.res.end(first.body);
  rememberExchange(d.userQuery, parsed.text, 'ollama');
}

/** Stream straight through, keeping a copy for auto-store. */
async function handleStream(d: ChatDispatch): Promise<void> {
  const bodyBuf = Buffer.from(JSON.stringify(d.body));
  const responseBody = await streamRequest(target, d.url, d.method, d.headers, bodyBuf, d.res)
    .catch(() => null);

  if (!responseBody) return; // error already written by streamRequest

  const parse = d.openai ? parseOpenAIResponse : parseOllamaResponse;
  rememberExchange(d.userQuery, parse(responseBody.toString()).text, 'ollama');
}

async function handleChatRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  rawBody: Buffer
): Promise<void> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody.toString());
  } catch {
    // Bytes we cannot decode are bytes we cannot enrich: forward them untouched
    // and let the upstream produce its own error, as a transparent proxy should.
    passthrough(target, req, res, rawBody);
    return;
  }

  // Decoded but not a chat request. A proxy fails closed: reject rather than
  // dereference it — `-d 'null'` used to take the whole process down.
  const validated = validateChatBody(decoded);
  if (!validated.ok) { rejectMalformed(res, validated.reason); return; }

  const openai = isOpenAIPath(url);
  const userQuery = extractUserQuery(validated.body);
  const body = userQuery
    ? await withRecalledContext(validated.body, userQuery, openai)
    : validated.body;

  const dispatch: ChatDispatch = {
    res,
    url,
    method: req.method ?? 'POST',
    headers: buildForwardHeaders(req.headers),
    body,
    openai,
    userQuery,
  };

  const hasTools = Array.isArray(body['tools']) && (body['tools'] as unknown[]).length > 0;
  await (hasTools && TOOL_RETRY ? handleToolCall(dispatch) : handleStream(dispatch));
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url ?? '/';

  const read = await readLimitedBody(req, MAX_BODY_BYTES);
  if (!read.ok) {
    if (read.reason === 'too-large') rejectTooLarge(req, res);
    return; // interrupted — there is no client left to answer
  }

  if (!isChatPath(url) || read.body.length === 0) {
    passthrough(target, req, res, read.body);
    return;
  }
  await handleChatRequest(req, res, url, read.body);
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

/** Answer a request whose handler threw, instead of letting the process die. */
function failRequest(res: http.ServerResponse, err: unknown): void {
  console.error(`[Engram] Request handler failed: ${err instanceof Error ? err.message : String(err)}`);
  if (!res.headersSent) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Proxy Error');
  } else if (!res.writableEnded) {
    res.end();
  }
}

const proxy = http.createServer((req, res) => {
  // The handler is async, so its rejection would otherwise escape the 'request'
  // listener as an unhandled rejection — which Node treats as fatal.
  void handleRequest(req, res).catch((err: unknown) => failRequest(res, err));
});

// Defence in depth: a rejection escaping any fire-and-forget path must degrade
// to a log line, never to a dead proxy that takes every in-flight chat with it.
process.on('unhandledRejection', (reason: unknown) => {
  console.error('[Engram] Unhandled rejection:', reason instanceof Error ? reason.message : reason);
});

let listening = false;
proxy.on('listening', () => { listening = true; });
proxy.on('error', (err: NodeJS.ErrnoException) => {
  console.error(`[Engram] Server error: ${err.code ?? ''} ${err.message}`.trim());
  // Never bound (EADDRINUSE, EACCES, …) means there is nothing to serve. Exit
  // non-zero: an idle process that later exits 0 reads as success to a
  // supervisor and hides the failure.
  if (!listening) process.exit(1);
});

proxy.listen(PROXY_PORT, LISTEN_HOST, () => {
  // Report the port the kernel actually assigned, not the one we asked for:
  // with OLLAMA_PROXY_PORT=0 the request is "any free port" and the banner
  // would otherwise advertise `:0`, which is not an address anyone can dial.
  const bound = proxy.address();
  const boundPort = typeof bound === 'object' && bound !== null ? bound.port : PROXY_PORT;

  console.info(`Engram × Ollama Proxy`);
  console.info(`  Listening:    http://${LISTEN_HOST}:${boundPort}`);
  if (LISTEN_HOST === DEFAULT_LISTEN_HOST) {
    console.info(`  Bind:         loopback only — set ENGRAM_PROXY_HOST=0.0.0.0 for LAN clients`);
  } else {
    console.warn(`  Bind:         ${LISTEN_HOST} — reachable off-host, and this proxy has no auth`);
  }
  console.info(`  Ollama target: ${OLLAMA_TARGET}`);
  console.info(`  Engram:   ${ENGRAM_API}`);
  console.info(`  Max body:     ${MAX_BODY_BYTES} bytes`);
  console.info(`  Tool retry:    ${TOOL_RETRY ? 'enabled' : 'disabled'}`);
  console.info('');
  console.info('Intercepts: /api/chat  /api/generate  /v1/chat/completions');
});
