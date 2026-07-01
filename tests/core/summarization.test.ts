import { test, expect, describe } from 'bun:test';
import { prepareForModel, summarize } from '../../src/core/context/manager.ts';
import { estimateTokens } from '../../src/core/context/truncation.ts';
import type { ChatChunk, Config, LLMClient, Message } from '../../src/core/types.ts';

function makeConfig(over: Partial<Config> = {}): Config {
  return {
    baseUrl: 'x',
    apiKey: 'x',
    model: 'm',
    maxIterations: 25,
    maxToolOutputChars: 4000,
    keepRecentTurns: 50,
    contextWindow: 1000,
    cwd: process.cwd(),
    approvalMode: 'manual',
    shellSafety: 'strict',
    shellBlacklist: [],
    shellWhitelist: [],
    allowShellRedirectOutsideCwd: false,
    enableSummarization: true,
    summarizeThreshold: 0.7,
    summarizeMinMessages: 6,
    ...over,
  };
}

function mockClient(summary: string, fail = false): LLMClient {
  return {
    async *streamChat(): AsyncIterable<ChatChunk> {
      if (fail) throw new Error('summary failed');
      if (summary) yield { contentDelta: summary };
      yield { usage: { prompt: 10, completion: 5, total: 15 } };
    },
  };
}

function buildLongMessages(count: number): Message[] {
  const messages: Message[] = [{ role: 'system', content: 'You are a coding assistant.' }];
  for (let i = 0; i < count; i++) {
    messages.push({ role: 'user', content: `task ${i} ` + 'x'.repeat(200) });
    messages.push({ role: 'assistant', content: `ack ${i} ` + 'y'.repeat(200) });
  }
  return messages;
}

describe('estimateTokens', () => {
  test('counts content characters divided by 4', () => {
    const messages: Message[] = [{ role: 'user', content: 'a'.repeat(100) }];
    expect(estimateTokens(messages)).toBe(25);
  });
  test('counts tool_calls', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', name: 'read_file', args: { path: 'a.txt' } }],
      },
    ];
    expect(estimateTokens(messages)).toBeGreaterThan(0);
  });
});

describe('prepareForModel summarization', () => {
  test('short history uses simple truncation, no summary', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const config = makeConfig({ contextWindow: 10000 });
    const result = await prepareForModel(messages, config, mockClient(''), new AbortController().signal);
    expect(result.length).toBe(messages.length);
    expect(result[result.length - 1]!.content).toBe('hello');
  });

  test('long history triggers summary and retains system + recent', async () => {
    const messages = buildLongMessages(10); // system + 20 messages, > 1000 tokens
    const config = makeConfig({ summarizeMinMessages: 6 });
    const result = await prepareForModel(messages, config, mockClient('COMPACT SUMMARY'), new AbortController().signal);

    // system + summary system + 6 recent messages
    expect(result.length).toBeLessThan(messages.length);
    expect(result[0]!.role).toBe('system');
    expect(result[0]!.content).toBe('You are a coding assistant.');
    expect(result[1]!.role).toBe('system');
    expect(result[1]!.content).toContain('COMPACT SUMMARY');
    expect(result[result.length - 1]!.role).toBe('assistant');
  });

  test('disabled summarization falls back to truncation', async () => {
    const messages = buildLongMessages(10);
    const config = makeConfig({ enableSummarization: false, keepRecentTurns: 4 });
    const result = await prepareForModel(messages, config, mockClient(''), new AbortController().signal);
    expect(result.some((m) => m.content?.includes('historical summary'))).toBe(false);
  });

  test('summary failure falls back to truncation', async () => {
    const messages = buildLongMessages(10);
    const config = makeConfig({ keepRecentTurns: 4 });
    const result = await prepareForModel(messages, config, mockClient('', true), new AbortController().signal);
    expect(result.some((m) => m.content?.includes('historical summary'))).toBe(false);
  });
});

describe('summarize directly', () => {
  test('sends old messages to the model and returns compacted history', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'old task' },
      { role: 'assistant', content: 'old ack' },
      { role: 'user', content: 'recent' },
      { role: 'assistant', content: 'recent ack' },
    ];
    const config = makeConfig({ summarizeMinMessages: 2 });
    const result = await summarize(messages, config, mockClient('summary text'), new AbortController().signal);
    expect(result.length).toBe(4); // system + summary + 2 recent
    expect(result[1]!.content).toContain('summary text');
  });
});
