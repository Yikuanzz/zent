/**
 * Context manager: orchestrates system-prompt presence and history truncation.
 * Summarization is reserved as a future extension point (no-op in stage A).
 */
import type { Config, Message } from '../types.ts';
import { truncateHistory } from './truncation.ts';

/** Apply the in-context-window budget before sending to the model. */
export function prepareForModel(messages: Message[], config: Config): Message[] {
  return truncateHistory(messages, config.keepRecentTurns);
}

/**
 * Reserved: summarize older history into a compact note (stage B/C).
 * Intentionally a no-op for now so the call site already exists.
 */
export function summarize(messages: Message[]): Message[] {
  return messages;
}
