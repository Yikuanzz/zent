/**
 * TUI-only view-model types. These describe what the conversation view renders;
 * they are derived from core AgentEvents by the useAgent hook.
 */
import type { PlanStep, ToolCall } from '../core/types.ts';

export type DisplayItem =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'assistant'; id: number; text: string; done: boolean }
  | { kind: 'plan'; id: number; steps: PlanStep[] }
  | {
      kind: 'tool';
      id: number;
      callId: string;
      name: string;
      args: ToolCall['args'];
      status: 'running' | 'ok' | 'failed' | 'denied';
      summary: string;
      full: string;
      durationMs: number;
      collapsed: boolean;
    }
  | { kind: 'finish'; id: number; text: string }
  | { kind: 'error'; id: number; text: string };

export type FocusMode = 'input' | 'running' | 'approval' | 'review';

export interface PlanState {
  steps: PlanStep[];
}
