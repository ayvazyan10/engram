#!/usr/bin/env node
/**
 * Engram × Ollama Transparent Proxy
 *
 * Sits between your Ollama client and Ollama server.
 * Intercepts requests, injects Engram memory context, stores responses.
 *
 * Usage:
 *   node dist/proxy.js
 *   # Then point your Ollama client to localhost:11435 instead of 11434
 *   OLLAMA_HOST=http://localhost:11435 ollama run llama3 "Hello!"
 *
 * Environment:
 *   OLLAMA_PROXY_PORT=11435       (default: 11435)
 *   OLLAMA_TARGET=http://localhost:11434  (default)
 *   ENGRAM_API=http://localhost:3001 (default)
 *   ENGRAM_MAX_TOKENS=1500   (context tokens to inject, default: 1500)
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';

const PROXY_PORT = parseInt(process.env['OLLAMA_PROXY_PORT'] ?? '11435', 10);
const OLLAMA_TARGET = process.env['OLLAMA_TARGET'] ?? 'http://localhost:11434';
const ENGRAM_API = process.env['ENGRAM_API'] ?? 'http://localhost:3001';
const MAX_TOKENS = parseInt(process.env['ENGRAM_MAX_TOKENS'] ?? '1500', 10);

/**
 * Call Engram /api/recall with the user's query.
 * Returns formatted context string (empty string if Engram is unavailable).
 */
async function recallContext(query: string): Promise<string> {
  try {
    const response = await fetch(`${ENGRAM_API}/api/recall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, maxTokens: MAX_TOKENS, source: 'ollama' }),
      signal: AbortSignal.timeout(3000), // 3s timeout — don't slow down Ollama
    });

    if (!response.ok) return '';
    const data = await response.json() as { context?: string };
    return data.context ?? '';
  } catch {
    // Engram unavailable — passthrough mode
    return '';
  }
}

/**
 * Store a memory in Engram.
 */
async function storeMemory(content: string, source: string = 'ollama'): Promise<void> {
  try {
    await fetch(`${ENGRAM_API}/api/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, type: 'episodic', source }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Ignore storage errors — don't break the response
  }
}

/**
 * Extract user message from Ollama API request body.
 * Supports both /api/chat and /api/generate endpoints.
 */
function extractUserQuery(body: Record<string, unknown>): string {
  // /api/chat format: { messages: [{role, content}] }
  if (Array.isArray(body['messages'])) {
    const messages = body['messages'] as Array<{ role: string; content: string }>;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    return lastUser?.content ?? '';
  }
  // /api/generate format: { prompt: string }
  return (body['prompt'] as string) ?? '';
}

/**
 * Inject Engram context into the Ollama request.
 */
function injectContext(body: Record<string, unknown>, context: string): Record<string, unknown> {
  if (!context) return body;

  // /api/chat format: inject as system message at beginning
  if (Array.isArray(body['messages'])) {
    const messages = body['messages'] as Array<{ role: string; content: string }>;
    const hasSystem = messages.some((m) => m.role === 'system');

    if (hasSystem) {
      // Append to existing system message
      return {
        ...body,
        messages: messages.map((m) =>
          m.role === 'system'
            ? { ...m, content: `${m.content}\n\n${context}` }
            : m
        ),
      };
    } else {
      // Prepend new system message
      return {
        ...body,
        messages: [{ role: 'system', content: context }, ...messages],
      };
    }
  }

  // /api/generate format: prepend to system field
  const existingSystem = (body['system'] as string) ?? '';
  return {
    ...body,
    system: existingSystem ? `${existingSystem}\n\n${context}` : context,
  };
}

// ─── HTTP Proxy Server ────────────────────────────────────────────────────────

const targetUrl = new URL(OLLAMA_TARGET);

const proxy = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];

  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', async () => {
    let requestBody = Buffer.concat(chunks);
    const isGenerateOrChat =
      req.url?.startsWith('/api/chat') || req.url?.startsWith('/api/generate');

    // Intercept generate/chat requests to inject memory
    if (isGenerateOrChat && requestBody.length > 0) {
      try {
        const parsed = JSON.parse(requestBody.toString()) as Record<string, unknown>;
        const userQuery = extractUserQuery(parsed);

        if (userQuery) {
          const context = await recallContext(userQuery);
          if (context) {
            const injected = injectContext(parsed, context);
            requestBody = Buffer.from(JSON.stringify(injected));
            console.info(`[Engram] Injected ${context.length} chars of context`);
          }
        }
      } catch {
        // Parse error — passthrough unchanged
      }
    }

    // Forward to Ollama
    const options: http.RequestOptions = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || 11434,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        'content-length': requestBody.length.toString(),
        host: targetUrl.host,
      },
    };

    const protocol = targetUrl.protocol === 'https:' ? https : http;
    const proxyReq = protocol.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);

      const responseChunks: Buffer[] = [];
      proxyRes.on('data', (chunk: Buffer) => {
        responseChunks.push(chunk);
        res.write(chunk); // stream to client
      });

      proxyRes.on('end', () => {
        res.end();

        // Store the response as episodic memory (fire-and-forget)
        if (isGenerateOrChat && responseChunks.length > 0) {
          const responseBody = Buffer.concat(responseChunks).toString();
          // Ollama streams JSON lines — extract the final response
          try {
            const lines = responseBody.split('\n').filter(Boolean);
            const lastLine = lines[lines.length - 1];
            if (lastLine) {
              const data = JSON.parse(lastLine) as { response?: string; message?: { content?: string } };
              const responseText = data.response ?? data.message?.content;
              if (responseText) {
                const userQuery = (() => {
                  try {
                    const parsed = JSON.parse(requestBody.toString()) as Record<string, unknown>;
                    return extractUserQuery(parsed);
                  } catch {
                    return '';
                  }
                })();

                if (userQuery && responseText) {
                  void storeMemory(
                    `User: ${userQuery}\nAssistant: ${responseText.slice(0, 1000)}`,
                    'ollama'
                  );
                }
              }
            }
          } catch {
            // Ignore storage errors
          }
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('[Engram] Proxy error:', err.message);
      res.writeHead(502);
      res.end('Bad Gateway: Ollama unavailable');
    });

    proxyReq.write(requestBody);
    proxyReq.end();
  });
});

proxy.listen(PROXY_PORT, () => {
  console.info(`Engram × Ollama Proxy`);
  console.info(`  Listening:    http://localhost:${PROXY_PORT}`);
  console.info(`  Ollama target: ${OLLAMA_TARGET}`);
  console.info(`  Engram:   ${ENGRAM_API}`);
  console.info('');
  console.info('Usage: OLLAMA_HOST=http://localhost:11435 ollama run llama3');
});
