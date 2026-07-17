export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCompletionOptions {
  maxTokens?: number;
  temperature?: number;
  system?: string;
}

export interface LLMCompletionResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  durationMs: number;
}

export interface LLMProvider {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMCompletionResult>;
  estimateTokens(text: string): number;
  getModel(): string;
  getContextWindow(): number;
}

export interface LLMConfig {
  provider: 'ollama' | 'claude' | 'none';
  model?: string;
  ollamaUrl?: string;
  anthropicKey?: string;
  maxInputTokens?: number;
}
