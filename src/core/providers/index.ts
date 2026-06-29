/**
 * Provider factory. Selects an LLM client implementation from config.
 * Only the OpenAI-compatible provider is implemented in stage A;
 * anthropic/ollama are reserved as future extension points.
 */
import type { Config, LLMClient } from '../types.ts';
import { createOpenAIClient } from './openai.ts';

export function createLLMClient(config: Config): LLMClient {
  // Stage A: single provider. Kept behind a factory so additional providers
  // (anthropic.ts, ollama.ts) can be added without touching the loop.
  return createOpenAIClient(config);
}
