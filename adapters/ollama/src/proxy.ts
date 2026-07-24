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
 *   OLLAMA_TARGET=http://localhost:11434
 *   ENGRAM_API=http://localhost:4901
 *   ENGRAM_MAX_TOKENS=1500
 *   ENGRAM_TOOL_RETRY=true        (set to "false" to disable retry)
 *   ENGRAM_UPSTREAM_TIMEOUT_MS=300000
 */

import http from 'http';
import { URL } from 'url';

import { extractUserQuery, injectContext, buildRetryBody } from './messages.js';
import { parseOllamaResponse, parseOpenAIResponse } from './parse.js';
import { buildForwardHeaders, isChatPath, isOpenAIPath } from './headers.js';
import { makeBufferedRequest, streamRequest, passthrough, type UpstreamTarget } from './upstream.js';

const PROXY_PORT = parseInt(process.env['OLLAMA_PROXY_PORT'] ?? '11435', 10);
const OLLAMA_TARGET = process.env['OLLAMA_TARGET'] ?? 'http://localhost:11434';
const ENGRAM_API = process.env['ENGRAM_API'] ?? 'http://localhost:4901';
const MAX_TOKENS = parseInt(process.env['ENGRAM_MAX_TOKENS'] ?? '1500', 10);
const TOOL_RETRY = process.env['ENGRAM_TOOL_RETRY'] !== 'false';
const UPSTREAM_TIMEOUT_MS = parseInt(process.env['ENGRAM_UPSTREAM_TIMEOUT_MS'] ?? '300000', 10);

const target: UpstreamTarget = {
  url: new URL(OLLAMA_TARGET),
  timeoutMs: UPSTREAM_TIMEOUT_MS,
};

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

// ─── Main proxy handler ───────────────────────────────────────────────────────

const proxy = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', async () => {
    const rawBody = Buffer.concat(chunks);
    const url = req.url ?? '/';

    if (!isChatPath(url) || rawBody.length === 0) {
      return passthrough(target, req, res, rawBody);
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString()) as Record<string, unknown>;
    } catch {
      return passthrough(target, req, res, rawBody);
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

    const forwardHeaders = buildForwardHeaders(req.headers);

    // ── Tool-call requests: buffer + retry on failure ──────────────────────
    if (hasTools && TOOL_RETRY) {
      const bodyBuf = Buffer.from(JSON.stringify(body));

      const first = await makeBufferedRequest(
        target, url, req.method ?? 'POST', forwardHeaders, bodyBuf
      ).catch(() => null);
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
          target, url, req.method ?? 'POST', forwardHeaders, retryBuf
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
    const responseBody = await streamRequest(
      target, url, req.method ?? 'POST', forwardHeaders, bodyBuf, res
    ).catch(() => null);

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
