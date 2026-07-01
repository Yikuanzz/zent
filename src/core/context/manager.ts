/**
 * Context manager: orchestrates system-prompt presence, history truncation,
 * and optional summarization of older messages.
 */
import type { Config, LLMClient, Message } from '../types.ts';
import { estimateTokens, truncateHistory } from './truncation.ts';

function needsSummarize(messages: Message[], config: Config): boolean {
  if (!config.enableSummarization) return false;
  if (config.contextWindow <= 0) return false;
  const estimated = estimateTokens(messages);
  if (estimated < config.contextWindow * config.summarizeThreshold) return false;
  // Keep system + recent minimum; compress only what is older.
  const compressibleCount = messages.length - 1 - config.summarizeMinMessages;
  return compressibleCount >= 2;
}

function formatMessageForSummary(m: Message): string {
  let text = `${m.role}: ${m.content ?? ''}`;
  if (m.tool_calls) {
    text += '\n[tool_calls] ' + m.tool_calls.map((tc) => `${tc.name}(${JSON.stringify(tc.args)})`).join('; ');
  }
  if (m.tool_call_id) {
    text += `\n[tool_call_id: ${m.tool_call_id}]`;
  }
  return text;
}

async function generateSummary(oldMessages: Message[], client: LLMClient, signal: AbortSignal): Promise<string> {
  const summaryPrompt: Message[] = [
    {
      role: 'system',
      content:
        'You compress conversation history for a coding agent. ' +
        'Keep key facts, user intent, completed operations and their results. ' +
        'Omit detailed code unless it is still relevant for the upcoming task. ' +
        'Respond with a concise paragraph in the same language as the history.',
    },
    {
      role: 'user',
      content:
        'Compress the following conversation history into a concise summary:\n\n' +
        oldMessages.map(formatMessageForSummary).join('\n\n---\n\n'),
    },
  ];

  let summary = '';
  for await (const chunk of client.streamChat({ messages: summaryPrompt, tools: [], signal })) {
    if (chunk.contentDelta) summary += chunk.contentDelta;
  }
  return summary.trim();
}

/**
 * Summarize older history and return a compacted message list.
 * On failure, falls back to sliding-window truncation.
 */
export async function summarize(
  messages: Message[],
  config: Config,
  client: LLMClient,
  signal: AbortSignal,
): Promise<Message[]> {
  const system = messages[0]?.role === 'system' ? messages[0] : null;
  const rest = system ? messages.slice(1) : messages.slice();
  const recent = rest.slice(-config.summarizeMinMessages);
  const old = rest.slice(0, rest.length - config.summarizeMinMessages);

  if (old.length === 0) return messages;

  try {
    const summaryText = await generateSummary(old, client, signal);
    const compacted: Message[] = [];
    if (system) compacted.push(system);
    if (summaryText) {
      compacted.push({
        role: 'system',
        content: `[historical summary]\n${summaryText}`,
      });
    }
    compacted.push(...recent);
    return compacted;
  } catch (e) {
    console.warn(`[zent] 摘要失败，回退到滑动窗口截断: ${(e as Error).message}`);
    return truncateHistory(messages, config.keepRecentTurns);
  }
}

/** Apply the in-context-window budget before sending to the model. */
export async function prepareForModel(
  messages: Message[],
  config: Config,
  client: LLMClient,
  signal: AbortSignal,
): Promise<Message[]> {
  if (needsSummarize(messages, config)) {
    return summarize(messages, config, client, signal);
  }
  return truncateHistory(messages, config.keepRecentTurns);
}
