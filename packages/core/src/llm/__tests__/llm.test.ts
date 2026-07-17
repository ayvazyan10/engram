import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLLMProvider } from '../index.js';
import { NullProvider } from '../NullProvider.js';
import { OllamaProvider } from '../OllamaProvider.js';
import { ClaudeProvider } from '../ClaudeProvider.js';

describe('LLM Provider Factory', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns NullProvider by default', () => {
    delete process.env['ENGRAM_LLM_PROVIDER'];
    const provider = createLLMProvider();
    expect(provider).toBeInstanceOf(NullProvider);
    expect(provider.id).toBe('none');
  });

  it('returns OllamaProvider when configured', () => {
    const provider = createLLMProvider({ provider: 'ollama' });
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.id).toBe('ollama');
  });

  it('returns ClaudeProvider when configured', () => {
    const provider = createLLMProvider({ provider: 'claude', anthropicKey: 'sk-test' });
    expect(provider).toBeInstanceOf(ClaudeProvider);
    expect(provider.id).toBe('claude');
  });

  it('reads provider from env var', () => {
    process.env['ENGRAM_LLM_PROVIDER'] = 'ollama';
    const provider = createLLMProvider();
    expect(provider).toBeInstanceOf(OllamaProvider);
  });

  it('config takes precedence over env var', () => {
    process.env['ENGRAM_LLM_PROVIDER'] = 'ollama';
    const provider = createLLMProvider({ provider: 'claude', anthropicKey: 'sk-test' });
    expect(provider).toBeInstanceOf(ClaudeProvider);
  });
});

describe('NullProvider', () => {
  const provider = new NullProvider();

  it('isAvailable returns false', async () => {
    expect(await provider.isAvailable()).toBe(false);
  });

  it('complete throws', async () => {
    await expect(provider.complete([{ role: 'user', content: 'hello' }]))
      .rejects.toThrow('No LLM provider configured');
  });

  it('estimateTokens approximates 4 chars per token', () => {
    expect(provider.estimateTokens('hello world')).toBe(3);
    expect(provider.estimateTokens('a'.repeat(100))).toBe(25);
  });

  it('getModel returns none', () => {
    expect(provider.getModel()).toBe('none');
  });

  it('getContextWindow returns 0', () => {
    expect(provider.getContextWindow()).toBe(0);
  });
});

describe('OllamaProvider', () => {
  it('uses configured model and URL', () => {
    const provider = new OllamaProvider({
      model: 'mistral',
      ollamaUrl: 'http://gpu-server:11434',
    });
    expect(provider.getModel()).toBe('mistral');
    expect(provider.getContextWindow()).toBe(32768);
  });

  it('reads model from env', () => {
    process.env['ENGRAM_LLM_MODEL'] = 'phi3';
    const provider = new OllamaProvider();
    expect(provider.getModel()).toBe('phi3');
    expect(provider.getContextWindow()).toBe(128000);
    delete process.env['ENGRAM_LLM_MODEL'];
  });

  it('isAvailable returns false when server not reachable', async () => {
    const provider = new OllamaProvider({ ollamaUrl: 'http://localhost:99999' });
    expect(await provider.isAvailable()).toBe(false);
  });

  it('complete calls Ollama chat API', async () => {
    const mockResponse = {
      message: { content: 'Summary of memories' },
      prompt_eval_count: 100,
      eval_count: 20,
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as unknown as Response);

    const provider = new OllamaProvider({ ollamaUrl: 'http://mock:11434', model: 'llama3.1' });
    const result = await provider.complete(
      [{ role: 'user', content: 'Summarize these' }],
      { system: 'You are a summarizer', maxTokens: 300 },
    );

    expect(result.content).toBe('Summary of memories');
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(20);
    expect(result.model).toBe('llama3.1');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe('http://mock:11434/api/chat');
    const body = JSON.parse(fetchCall[1].body);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
    expect(body.options.num_predict).toBe(300);
  });

  it('throws on API error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal server error'),
    } as unknown as Response);

    const provider = new OllamaProvider({ ollamaUrl: 'http://mock:11434' });
    await expect(provider.complete([{ role: 'user', content: 'test' }]))
      .rejects.toThrow('Ollama API error 500');
  });
});

describe('ClaudeProvider', () => {
  it('isAvailable returns false without API key', async () => {
    const provider = new ClaudeProvider({ anthropicKey: '' });
    expect(await provider.isAvailable()).toBe(false);
  });

  it('isAvailable returns true with API key', async () => {
    const provider = new ClaudeProvider({ anthropicKey: 'sk-ant-test' });
    expect(await provider.isAvailable()).toBe(true);
  });

  it('uses configured model', () => {
    const provider = new ClaudeProvider({ model: 'claude-haiku-4-5-20251001' });
    expect(provider.getModel()).toBe('claude-haiku-4-5-20251001');
    expect(provider.getContextWindow()).toBe(200000);
  });

  it('complete calls Anthropic Messages API', async () => {
    const mockResponse = {
      content: [{ type: 'text', text: 'Consolidated insight' }],
      usage: { input_tokens: 150, output_tokens: 30 },
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as unknown as Response);

    const provider = new ClaudeProvider({ anthropicKey: 'sk-ant-test', model: 'claude-sonnet-4-20250514' });
    const result = await provider.complete(
      [{ role: 'user', content: 'Summarize these memories' }],
      { system: 'You are a consolidation system', maxTokens: 200, temperature: 0.2 },
    );

    expect(result.content).toBe('Consolidated insight');
    expect(result.inputTokens).toBe(150);
    expect(result.outputTokens).toBe(30);

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(fetchCall[1].body);
    expect(body.system).toBe('You are a consolidation system');
    expect(body.model).toBe('claude-sonnet-4-20250514');
    expect(body.max_tokens).toBe(200);
    expect(body.temperature).toBe(0.2);
    expect(fetchCall[1].headers['x-api-key']).toBe('sk-ant-test');
  });

  it('throws without API key', async () => {
    const provider = new ClaudeProvider({ anthropicKey: '' });
    await expect(provider.complete([{ role: 'user', content: 'test' }]))
      .rejects.toThrow('ENGRAM_ANTHROPIC_KEY not configured');
  });
});
