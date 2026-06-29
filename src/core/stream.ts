/**
 * Streaming helper. Consumes a provider's chunk stream, emits `thinking`
 * events for content deltas, and reassembles fragmented tool-call deltas
 * (accumulated by index) into complete ToolCall objects.
 *
 * Used by the agent loop via `yield*`, so it both yields events AND returns
 * the assembled result.
 */
import type { AgentEvent, ChatChunk, LLMClient, Message, ToolCall, TokenUsage } from './types.ts';
import type { JSONSchema } from './types.ts';

export interface StreamResult {
  content: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
}

interface PartialToolCall {
  id: string;
  name: string;
  args: string; // accumulated JSON string fragments
}

export async function* streamModel(
  client: LLMClient,
  params: {
    messages: Message[];
    tools: { name: string; description: string; schema: JSONSchema }[];
    signal: AbortSignal;
  },
): AsyncGenerator<AgentEvent, StreamResult, unknown> {
  let content = '';
  let usage: TokenUsage | undefined;
  const partials = new Map<number, PartialToolCall>();

  for await (const chunk of client.streamChat(params) as AsyncIterable<ChatChunk>) {
    if (chunk.contentDelta) {
      content += chunk.contentDelta;
      yield { type: 'thinking', delta: chunk.contentDelta };
    }

    if (chunk.toolCallDelta) {
      const { index, id, name, argsDelta } = chunk.toolCallDelta;
      const existing = partials.get(index) ?? { id: '', name: '', args: '' };
      if (id) existing.id = id;
      if (name) existing.name = name;
      if (argsDelta) existing.args += argsDelta;
      partials.set(index, existing);
    }

    if (chunk.usage) {
      usage = chunk.usage;
    }
  }

  const toolCalls: ToolCall[] = [];
  for (const [index, p] of [...partials.entries()].sort((a, b) => a[0] - b[0])) {
    let args: Record<string, unknown> = {};
    if (p.args.trim()) {
      try {
        args = JSON.parse(p.args);
      } catch {
        // Malformed arguments — surface as an empty object; the tool will
        // report a validation error that the model can recover from.
        args = { __parse_error__: p.args };
      }
    }
    toolCalls.push({ id: p.id || `call_${index}`, name: p.name, args });
  }

  return { content, toolCalls, usage };
}
