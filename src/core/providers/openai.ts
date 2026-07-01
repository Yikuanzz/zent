/**
 * OpenAI-compatible provider. Maps the OpenAI SDK's streaming chunks into our
 * neutral ChatChunk shape (content deltas, tool-call fragments, usage).
 *
 * Tool-call fragment reassembly (accumulating id/name/arguments by index) is
 * done by the consumer (see core/stream.ts) so this layer stays a thin adapter.
 */
import OpenAI from 'openai';
import type { ChatChunk, Config, JSONSchema, LLMClient, Message } from '../types.ts';

function toOpenAIMessages(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
  // Validate / repair: every assistant message with tool_calls must be followed
  // by tool messages whose tool_call_id matches each tool_call.id. If a response
  // is missing, inject a synthetic "empty" tool response so the API accepts the
  // conversation rather than crashing with 400.
  const responded = new Set<string>();
  const repairIds: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m?.role === 'tool' && m.tool_call_id) {
      responded.add(m.tool_call_id);
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m?.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      for (const tc of m.tool_calls) {
        if (!responded.has(tc.id)) {
          repairIds.push(tc.id);
        }
      }
    }
  }

  const out: OpenAI.ChatCompletionMessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'assistant') {
      const toolCalls = m.tool_calls ?? [];
      const hasTools = toolCalls.length > 0;
      out.push({
        role: 'assistant',
        // OpenAI requires content to be null (not empty string) when tool_calls are present.
        content: hasTools ? null : (m.content ?? ''),
        ...(hasTools
          ? {
              tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: JSON.stringify(tc.args) },
              })),
            }
          : {}),
      });
      continue;
    }
    if (m.role === 'tool') {
      out.push({
        role: 'tool',
        content: m.content ?? '',
        tool_call_id: m.tool_call_id!,
      });
      continue;
    }
    out.push({ role: m.role, content: m.content ?? '' } as OpenAI.ChatCompletionMessageParam);
  }

  for (const id of repairIds) {
    // eslint-disable-next-line no-console
    console.error(`[zent] warning: tool_call_id ${id} missing response; injecting placeholder.`);
    out.push({ role: 'tool', content: '[tool response missing]', tool_call_id: id });
  }

  return out;
}

function toOpenAITools(
  tools: { name: string; description: string; schema: JSONSchema }[],
): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.schema as unknown as Record<string, unknown> },
  }));
}

export function createOpenAIClient(config: Config): LLMClient {
  const client = new OpenAI({ baseURL: config.baseUrl, apiKey: config.apiKey });

  return {
    async *streamChat({ messages, tools, signal }): AsyncIterable<ChatChunk> {
      const stream = await client.chat.completions.create(
        {
          model: config.model,
          messages: toOpenAIMessages(messages),
          tools: toOpenAITools(tools),
          stream: true,
          // Ask the model to emit one tool call at a time. Not all providers
          // honor this, so the agent loop also defensively handles multi-call
          // assistant messages by executing every tool_call sequentially.
          parallel_tool_calls: false,
          stream_options: { include_usage: true },
        },
        { signal },
      );

      for await (const part of stream) {
        const choice = part.choices[0];
        const delta = choice?.delta;

        if (delta?.content) {
          yield { contentDelta: delta.content };
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            yield {
              toolCallDelta: {
                index: tc.index,
                id: tc.id,
                name: tc.function?.name,
                argsDelta: tc.function?.arguments,
              },
            };
          }
        }

        if (part.usage) {
          yield {
            usage: {
              prompt: part.usage.prompt_tokens,
              completion: part.usage.completion_tokens,
              total: part.usage.total_tokens,
            },
          };
        }
      }
    },
  };
}
