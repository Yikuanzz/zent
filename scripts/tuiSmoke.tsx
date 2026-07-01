/**
 * TUI render smoke check: mount the real App with a mock client + fake config,
 * flush one frame, then unmount. Validates the component tree compiles and
 * renders under Bun without needing API credentials or a full TTY.
 */
import React from 'react';
import { render } from 'ink';
import { App } from '../src/tui/App.tsx';
import { registry } from '../src/core/tools/index.ts';
import type { ChatChunk, Config, LLMClient } from '../src/core/types.ts';

const mockClient: LLMClient = {
  async *streamChat(): AsyncIterable<ChatChunk> {
    yield { contentDelta: 'hello' };
    yield { usage: { prompt: 1, completion: 1, total: 2 } };
  },
};

const config: Config = {
  baseUrl: 'x',
  apiKey: 'x',
  model: 'mock-model',
  maxIterations: 25,
  maxToolOutputChars: 4000,
  keepRecentTurns: 50,
  contextWindow: 128000,
  cwd: process.cwd(),
  approvalMode: 'manual',
};

const instance = render(
  <App config={config} client={mockClient} tools={registry} systemPrompt="sys" />,
);
await new Promise((r) => setTimeout(r, 150));
instance.unmount();
instance.clear();
console.log('\n[tui-smoke] App mounted & rendered OK');
process.exit(0);
