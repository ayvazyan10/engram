export type { LLMProvider, LLMConfig, LLMMessage, LLMCompletionOptions, LLMCompletionResult } from './LLMProvider.js';
export { NullProvider } from './NullProvider.js';
export { OllamaProvider } from './OllamaProvider.js';
export { ClaudeProvider } from './ClaudeProvider.js';

import type { LLMConfig } from './LLMProvider.js';
import type { LLMProvider } from './LLMProvider.js';
import { NullProvider } from './NullProvider.js';
import { OllamaProvider } from './OllamaProvider.js';
import { ClaudeProvider } from './ClaudeProvider.js';

export function createLLMProvider(config?: Partial<LLMConfig>): LLMProvider {
  const provider = config?.provider
    ?? (process.env['ENGRAM_LLM_PROVIDER'] as LLMConfig['provider'] | undefined)
    ?? 'none';

  switch (provider) {
    case 'ollama':
      return new OllamaProvider(config);
    case 'claude':
      return new ClaudeProvider(config);
    default:
      return new NullProvider();
  }
}
