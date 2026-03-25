/**
 * Engram × OpenClaw Adapter
 *
 * Provides OpenClaw agents with access to Engram's persistent memory.
 *
 * Usage in OpenClaw agents:
 *   import { EngramClient } from '@engram-ai-memory/adapter-openclaw';
 *   const memory = new EngramClient();
 *   const context = await memory.recall('what did the user ask about last time?');
 *
 * Configuration: Set ENGRAM_API environment variable or pass url to constructor.
 * Or add to ~/.openclaw/openclaw.json:
 *   { "engram": { "url": "http://localhost:4901" } }
 */

export interface RecallResult {
  context: string;
  memories: Array<{
    id: string;
    type: string;
    score: number;
    source: string | null;
  }>;
  latencyMs: number;
}

export interface StoreResult {
  id: string;
  type: string;
}

export interface MemoryStats {
  total: number;
  byType: Record<string, number>;
  bySource: Record<string, number>;
}

export class EngramClient {
  private readonly baseUrl: string;
  private readonly source: string;
  private readonly defaultTimeout: number;

  constructor(options: { url?: string; source?: string; timeoutMs?: number } = {}) {
    this.baseUrl =
      options.url ??
      process.env['ENGRAM_API'] ??
      'http://localhost:4901';
    this.source = options.source ?? 'openclaw';
    this.defaultTimeout = options.timeoutMs ?? 5000;
  }

  /**
   * Recall the most relevant memory context for a query.
   * Returns formatted context string ready to inject into AI prompts.
   */
  async recall(query: string, maxTokens: number = 1500): Promise<RecallResult> {
    const response = await this.post('/api/recall', {
      query,
      maxTokens,
      source: this.source,
    });
    return response as RecallResult;
  }

  /**
   * Store a new memory.
   */
  async store(
    content: string,
    type: 'episodic' | 'semantic' | 'procedural' = 'episodic',
    options: { tags?: string[]; importance?: number; sessionId?: string } = {}
  ): Promise<StoreResult> {
    const response = await this.post('/api/memory', {
      content,
      type,
      source: this.source,
      ...options,
    });
    return response as StoreResult;
  }

  /**
   * Semantic search across memories.
   */
  async search(
    query: string,
    options: { topK?: number; types?: string[]; threshold?: number } = {}
  ): Promise<unknown[]> {
    const response = await this.post('/api/search', {
      query,
      topK: options.topK ?? 10,
      threshold: options.threshold ?? 0.3,
      types: options.types,
    }) as { results: unknown[] };
    return response.results ?? [];
  }

  /**
   * Get memory system statistics.
   */
  async stats(): Promise<MemoryStats> {
    const response = await this.get('/api/stats');
    return response as MemoryStats;
  }

  /**
   * Check if Engram is reachable.
   */
  async ping(): Promise<boolean> {
    try {
      const response = await this.get('/api/health');
      return (response as { status?: string }).status === 'ok';
    } catch {
      return false;
    }
  }

  private async get(path: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      signal: AbortSignal.timeout(this.defaultTimeout),
    });
    if (!response.ok) throw new Error(`Engram API error: ${response.status}`);
    return response.json();
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.defaultTimeout),
    });
    if (!response.ok) throw new Error(`Engram API error: ${response.status}`);
    return response.json();
  }
}

/**
 * Convenience function: recall context and format for injection.
 * Returns empty string if Engram is unavailable (graceful degradation).
 */
export async function withMemory(
  query: string,
  options: { url?: string; source?: string; maxTokens?: number } = {}
): Promise<string> {
  try {
    const client = new EngramClient({ url: options.url, source: options.source });
    const result = await client.recall(query, options.maxTokens);
    return result.context;
  } catch {
    return ''; // Engram unavailable — continue without memory
  }
}
