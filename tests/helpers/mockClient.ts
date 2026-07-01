/**
 * Shared mock LLMClient factory for tests.
 *
 * Given a scripted sequence of turns, emits the matching ChatChunk fragments.
 * Each turn may provide plain assistant content and/or a single tool call.
 */
import type { ChatChunk, LLMClient } from '../../src/core/types.ts';

export type ScriptedTurn = {
  content?: string;
  tool?: { name: string; args: Record<string, unknown> };
};

export function mockClientFromScript(script: ScriptedTurn[]): LLMClient {
  let step = 0;
  return {
    async *streamChat(): AsyncIterable<ChatChunk> {
      const s = script[Math.min(step++, script.length - 1)];
      if (!s) return;
      if (s.content) yield { contentDelta: s.content };
      if (s.tool) {
        yield { toolCallDelta: { index: 0, id: `call_${step}`, name: s.tool.name } };
        yield { toolCallDelta: { index: 0, argsDelta: JSON.stringify(s.tool.args) } };
      }
      yield { usage: { prompt: 10, completion: 5, total: 15 } };
    },
  };
}

/** Drive a runAgent generator to completion, optionally answering approvals. */
import type { AgentEvent, ApprovalDecision } from '../../src/core/types.ts';

export async function driveAgent(
  gen: AsyncGenerator<AgentEvent, void, ApprovalDecision>,
  onDecision?: (event: AgentEvent) => ApprovalDecision,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  let pending: ApprovalDecision = undefined;
  while (true) {
    const { value, done } = await gen.next(pending);
    pending = undefined;
    if (done || !value) break;
    events.push(value);
    if (onDecision) pending = onDecision(value);
  }
  return events;
}
