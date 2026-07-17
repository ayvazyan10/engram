import type { LLMProvider, LLMMessage, LLMCompletionOptions, LLMCompletionResult, LLMConfig } from './LLMProvider.js';

const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-20250514';

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-sonnet-4-20250514': 200000,
  'claude-haiku-4-5-20251001': 200000,
  'claude-opus-4-20250514': 200000,
};

export class ClaudeProvider implements LLMProvider {
  readonly id = 'claude';
  private apiKey: string;
  private model: string;

  constructor(config?: Partial<LLMConfig>) {
    this.apiKey = config?.anthropicKey
      ?? process.env['ENGRAM_ANTHROPIC_KEY']
      ?? '';
    this.model = config?.model
      ?? process.env['ENGRAM_LLM_MODEL']
      ?? DEFAULT_CLAUDE_MODEL;
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMCompletionResult> {
    if (!this.apiKey) {
      throw new Error('ENGRAM_ANTHROPIC_KEY not configured');
    }

    const startMs = Date.now();

    const apiMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role, content: m.content }));

    const systemText = options?.system
      ?? messages.find(m => m.role === 'system')?.content;

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options?.maxTokens ?? 512,
      messages: apiMessages,
    };

    if (systemText) {
      body.system = systemText;
    }

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Claude API error ${res.status}: ${errorText}`);
    }

    const data = await res.json() as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const content = data.content
      ?.filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('') ?? '';

    const durationMs = Date.now() - startMs;

    return {
      content,
      inputTokens: data.usage?.input_tokens ?? this.estimateTokens(JSON.stringify(messages)),
      outputTokens: data.usage?.output_tokens ?? this.estimateTokens(content),
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
    return MODEL_CONTEXT_WINDOWS[this.model] ?? 200000;
  }
}
