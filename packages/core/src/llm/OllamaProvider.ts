import type { LLMProvider, LLMMessage, LLMCompletionOptions, LLMCompletionResult, LLMConfig } from './LLMProvider.js';

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'llama3.1';

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'llama3.1': 131072,
  'llama3.1:8b': 131072,
  'llama3.1:70b': 131072,
  'mistral': 32768,
  'mixtral': 32768,
  'qwen2.5': 32768,
  'gemma2': 8192,
  'phi3': 128000,
};

export class OllamaProvider implements LLMProvider {
  readonly id = 'ollama';
  private baseUrl: string;
  private model: string;

  constructor(config?: Partial<LLMConfig>) {
    this.baseUrl = config?.ollamaUrl
      ?? process.env['ENGRAM_LLM_URL']
      ?? DEFAULT_OLLAMA_URL;
    this.model = config?.model
      ?? process.env['ENGRAM_LLM_MODEL']
      ?? DEFAULT_OLLAMA_MODEL;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMCompletionResult> {
    const startMs = Date.now();

    const ollamaMessages = options?.system
      ? [{ role: 'system' as const, content: options.system }, ...messages]
      : messages;

    const body = {
      model: this.model,
      messages: ollamaMessages,
      stream: false,
      options: {
        num_predict: options?.maxTokens ?? 512,
        temperature: options?.temperature ?? 0.3,
      },
    };

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Ollama API error ${res.status}: ${errorText}`);
    }

    const data = await res.json() as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const content = data.message?.content ?? '';
    const durationMs = Date.now() - startMs;

    return {
      content,
      inputTokens: data.prompt_eval_count ?? this.estimateTokens(ollamaMessages.map(m => m.content).join('')),
      outputTokens: data.eval_count ?? this.estimateTokens(content),
      model: this.model,
      durationMs,
    };
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  getModel(): string {
    return this.model;
  }

  getContextWindow(): number {
    return MODEL_CONTEXT_WINDOWS[this.model] ?? 8192;
  }
}
