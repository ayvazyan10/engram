import type { LLMProvider, LLMMessage, LLMCompletionOptions, LLMCompletionResult } from './LLMProvider.js';

export class NullProvider implements LLMProvider {
  readonly id = 'none';

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async complete(_messages: LLMMessage[], _options?: LLMCompletionOptions): Promise<LLMCompletionResult> {
    throw new Error('No LLM provider configured. Set ENGRAM_LLM_PROVIDER to "ollama" or "claude".');
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  getModel(): string {
    return 'none';
  }

  getContextWindow(): number {
    return 0;
  }
}
