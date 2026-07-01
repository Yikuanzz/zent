/**
 * Core type definitions. Pure types only — no logic, no React, no UI.
 * Shared by the agent loop (core) and the TUI (presentation).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Messages (OpenAI-compatible chat shape)
// ─────────────────────────────────────────────────────────────────────────────

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  /** Provider-assigned id, used to correlate the tool result message. */
  id: string;
  name: string;
  /** Parsed arguments object (provider returns a JSON string; we parse it). */
  args: Record<string, unknown>;
}

export interface Message {
  role: Role;
  content: string | null;
  /** Present on assistant turns that requested tool calls. */
  tool_calls?: ToolCall[];
  /** Present on tool-result turns; correlates back to a ToolCall.id. */
  tool_call_id?: string;
  /** Tool name, present on tool-result turns. */
  name?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan (produced by the update_plan tool, rendered in the status panel)
// ─────────────────────────────────────────────────────────────────────────────

export type PlanStepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface PlanStep {
  title: string;
  status: PlanStepStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// Events (core → consumer, single direction). The TUI subscribes to these.
// ─────────────────────────────────────────────────────────────────────────────

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export type AgentEvent =
  | { type: 'turn_start'; iteration: number }
  | { type: 'thinking'; delta: string }
  | { type: 'assistant_message'; content: string }
  | { type: 'tool_start'; call: ToolCall; dangerous: boolean }
  | { type: 'approval_required'; call: ToolCall }
  | { type: 'suggest_plan_approval'; plan: PlanStep[]; nextCall: ToolCall }
  | { type: 'tool_denied'; call: ToolCall }
  | { type: 'tool_end'; callId: string; name: string; ok: boolean; summary: string; full: string; durationMs: number }
  | { type: 'plan_update'; steps: PlanStep[] }
  | { type: 'token_usage'; usage: TokenUsage }
  | { type: 'finish'; summary: string }
  | { type: 'error'; message: string }
  | { type: 'aborted' };

/**
 * Decision passed back INTO the generator via `gen.next(decision)`.
 * Meaningful after `approval_required` or `suggest_plan_approval`; otherwise undefined.
 */
export type ApprovalDecision = { approved: boolean } | undefined;

// ─────────────────────────────────────────────────────────────────────────────
// Tools
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal JSON Schema shape we pass to the model's `tools` parameter. */
export interface JSONSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolContext {
  /** Working directory all file/shell operations are confined to. */
  cwd: string;
  signal: AbortSignal;
  /** Truncation/limit config the tool may consult. */
  config: Config;
}

export interface ToolResult {
  ok: boolean;
  /** Short one-line summary for the UI (collapsed view). */
  summary: string;
  /** Full output fed back to the model (subject to output truncation). */
  full: string;
  /** Only set by update_plan. */
  plan?: PlanStep[];
}

export interface Tool {
  name: string;
  description: string;
  schema: JSONSchema;
  /** Whether execution requires user approval (side effects). */
  dangerous: boolean;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM provider
// ─────────────────────────────────────────────────────────────────────────────

/** A streamed chunk from the provider. Fields are incremental/partial. */
export interface ChatChunk {
  /** Incremental assistant text content. */
  contentDelta?: string;
  /** Incremental tool-call fragments, keyed by their array index. */
  toolCallDelta?: { index: number; id?: string; name?: string; argsDelta?: string };
  /** Usage, typically only on the final chunk. */
  usage?: TokenUsage;
}

export interface LLMClient {
  streamChat(params: {
    messages: Message[];
    tools: { name: string; description: string; schema: JSONSchema }[];
    signal: AbortSignal;
  }): AsyncIterable<ChatChunk>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

export interface Pricing {
  /** Price per 1M input tokens. */
  input: number;
  /** Price per 1M output tokens. */
  output: number;
}

export type ApprovalMode = 'manual' | 'suggest' | 'full-auto';

export interface Config {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxIterations: number;
  maxToolOutputChars: number;
  /** Number of recent non-system turns to keep when truncating history. */
  keepRecentTurns: number;
  /** Optional; when absent, Cost is not computed (only token counts shown). */
  pricing?: Pricing;
  /** Approx. model context window (tokens) for the usage progress bar. */
  contextWindow: number;
  /** Working directory; defaults to process.cwd(). */
  cwd: string;
  /** Dangerous tool approval mode. */
  approvalMode: ApprovalMode;
}
