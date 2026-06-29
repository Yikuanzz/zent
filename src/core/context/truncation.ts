/**
 * Truncation utilities (context management strategies B + D from the PRD).
 *
 *  D — large tool output truncation: keep head + tail, mark the elision.
 *  B — sliding-window history truncation: always keep the system message and
 *      the most recent N turns; drop the oldest. Assistant turns that issued
 *      tool calls are kept paired with their tool-result messages to avoid
 *      orphaned tool_call_id references (which the API rejects).
 */
import type { Message } from '../types.ts';

/** D: truncate an oversized tool output, preserving head and tail. */
export function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const keep = Math.floor((maxChars - 40) / 2);
  if (keep <= 0) return text.slice(0, maxChars);
  const head = text.slice(0, keep);
  const tail = text.slice(text.length - keep);
  const elided = text.length - keep * 2;
  return `${head}\n…(已截断 ${elided} 字符)…\n${tail}`;
}

/**
 * B: keep system message + most recent turns. We measure "turns" as
 * non-system messages and keep the last `keepRecentTurns`, but we never split
 * an assistant(tool_calls) message from its following tool messages.
 */
export function truncateHistory(messages: Message[], keepRecentTurns: number): Message[] {
  if (messages.length === 0) return messages;

  const system = messages[0]?.role === 'system' ? [messages[0]] : [];
  const rest = system.length ? messages.slice(1) : messages.slice();

  if (rest.length <= keepRecentTurns) return messages;

  // Take the last keepRecentTurns messages as the candidate window.
  let start = rest.length - keepRecentTurns;

  // Don't start the window on an orphan tool message (its assistant parent
  // would be dropped). Walk back to include the owning assistant turn.
  while (start > 0 && rest[start]?.role === 'tool') {
    start--;
  }

  return [...system, ...rest.slice(start)];
}
