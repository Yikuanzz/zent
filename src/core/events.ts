/**
 * Event constructor helpers. Tiny factories so the loop reads cleanly and
 * event shapes stay consistent. Pure data — no side effects.
 */
import type { AgentEvent, PlanStep, ToolCall, TokenUsage } from './types.ts';

export const ev = {
  turnStart: (iteration: number): AgentEvent => ({ type: 'turn_start', iteration }),
  toolStart: (call: ToolCall, dangerous: boolean): AgentEvent => ({ type: 'tool_start', call, dangerous }),
  approvalRequired: (call: ToolCall): AgentEvent => ({ type: 'approval_required', call }),
  toolDenied: (call: ToolCall): AgentEvent => ({ type: 'tool_denied', call }),
  toolEnd: (
    callId: string,
    name: string,
    ok: boolean,
    summary: string,
    full: string,
    durationMs: number,
  ): AgentEvent => ({
    type: 'tool_end',
    callId,
    name,
    ok,
    summary,
    full,
    durationMs,
  }),
  planUpdate: (steps: PlanStep[]): AgentEvent => ({ type: 'plan_update', steps }),
  tokenUsage: (usage: TokenUsage): AgentEvent => ({ type: 'token_usage', usage }),
  assistantMessage: (content: string): AgentEvent => ({ type: 'assistant_message', content }),
  finish: (summary: string): AgentEvent => ({ type: 'finish', summary }),
  error: (message: string): AgentEvent => ({ type: 'error', message }),
  aborted: (): AgentEvent => ({ type: 'aborted' }),
};
