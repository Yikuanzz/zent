/**
 * The agent loop engine. A pure async generator with NO UI/React dependency.
 *
 *   - yields AgentEvent (single direction: core → consumer)
 *   - receives ApprovalDecision back via `gen.next(decision)` (only meaningful
 *     immediately after an `approval_required` event)
 *   - cancellation flows through AbortSignal, not the generator
 *
 * This same generator is driven by the TUI (src/tui/useAgent.ts) and by the
 * headless script (scripts/runHeadless.ts).
 */
import type {
  AgentEvent,
  ApprovalDecision,
  Config,
  LLMClient,
  Message,
  Tool,
  ToolCall,
} from './types.ts';
import { ev } from './events.ts';
import { streamModel } from './stream.ts';
import { prepareForModel } from './context/manager.ts';
import { truncateOutput } from './context/truncation.ts';

export interface RunAgentOptions {
  /** Full, mutable conversation history (system + accumulated turns). */
  messages: Message[];
  client: LLMClient;
  config: Config;
  signal: AbortSignal;
  /** name → Tool. */
  tools: Record<string, Tool>;
}

/** Push an assistant turn (possibly with tool calls) into history. */
function appendAssistant(messages: Message[], content: string, toolCalls: ToolCall[]): void {
  messages.push({
    role: 'assistant',
    content: content || null,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  });
}

/** Push a tool-result observation into history (tool role, correlated by id). */
function appendToolResult(messages: Message[], call: ToolCall, output: string): void {
  messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: output });
}

export async function* runAgent(
  opts: RunAgentOptions,
): AsyncGenerator<AgentEvent, void, ApprovalDecision> {
  const { messages, client, config, signal, tools } = opts;
  const toolSpecList = Object.values(tools).map((t) => ({
    name: t.name,
    description: t.description,
    schema: t.schema,
  }));

  for (let i = 0; i < config.maxIterations; i++) {
    if (signal.aborted) {
      yield ev.aborted();
      return;
    }
    yield ev.turnStart(i);

    // 1. Stream the model. streamModel yields `thinking` events and returns
    //    the assembled { content, toolCalls, usage }.
    let result;
    try {
      result = yield* streamModel(client, {
        messages: prepareForModel(messages, config),
        tools: toolSpecList,
        signal,
      });
    } catch (e) {
      if (signal.aborted) {
        yield ev.aborted();
        return;
      }
      yield ev.error(`模型调用失败: ${(e as Error).message}`);
      return;
    }

    if (result.usage) yield ev.tokenUsage(result.usage);
    if (result.content) yield ev.assistantMessage(result.content);

    appendAssistant(messages, result.content, result.toolCalls);

    // 2. No tool call → natural stop. The content was already emitted via
    //    `assistant_message`; emit an empty finish so the UI doesn't duplicate it.
    if (result.toolCalls.length === 0) {
      yield ev.finish('');
      return;
    }

    // Single tool per turn.
    const call = result.toolCalls[0]!;
    const tool = tools[call.name];

    if (!tool) {
      appendToolResult(messages, call, `错误: 未知工具 "${call.name}"`);
      yield ev.toolEnd(call.id, call.name, false, `未知工具: ${call.name}`, '', 0);
      continue;
    }

    yield ev.toolStart(call, tool.dangerous);

    // 3. Dangerous tool → pause for approval via generator two-way value.
    let approved = true;
    if (tool.dangerous) {
      const decision: ApprovalDecision = yield ev.approvalRequired(call);
      approved = decision?.approved === true;
    }
    if (!approved) {
      yield ev.toolDenied(call);
      appendToolResult(messages, call, '[用户拒绝执行该工具调用]');
      continue;
    }

    // 4. Execute. Failures become observations — the loop does NOT abort.
    const startedAt = Date.now();
    let toolResult;
    try {
      toolResult = await tool.run(call.args, { cwd: config.cwd, signal, config });
    } catch (e) {
      toolResult = { ok: false, summary: `工具异常: ${call.name}`, full: String(e) };
    }
    const durationMs = Date.now() - startedAt;

    if (call.name === 'update_plan' && toolResult.plan) {
      yield ev.planUpdate(toolResult.plan);
    }
    yield ev.toolEnd(call.id, call.name, toolResult.ok, toolResult.summary, toolResult.full, durationMs);

    appendToolResult(messages, call, truncateOutput(toolResult.full, config.maxToolOutputChars));

    // 5. finish terminates the loop.
    if (call.name === 'finish') {
      yield ev.finish(toolResult.full);
      return;
    }
  }

  yield ev.finish(`已达最大迭代次数 (${config.maxIterations})，自动停止。`);
}
