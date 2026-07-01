import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../../src/core/agent.ts';
import { registry } from '../../src/core/tools/index.ts';
import { buildSystemPrompt } from '../../src/core/prompt.ts';
import { mockClientFromScript, driveAgent } from '../helpers/mockClient.ts';
import type { ApprovalDecision, Config, Message } from '../../src/core/types.ts';

let dir: string;
function config(over: Partial<Config> = {}): Config {
  return {
    baseUrl: 'x',
    apiKey: 'x',
    model: 'm',
    maxIterations: 25,
    maxToolOutputChars: 4000,
    keepRecentTurns: 50,
    contextWindow: 128000,
    cwd: dir,
    approvalMode: 'manual',
    shellSafety: 'strict',
    shellBlacklist: [],
    shellWhitelist: [],
    allowShellRedirectOutsideCwd: false,
    enableSummarization: false,
    summarizeThreshold: 0.7,
    summarizeMinMessages: 6,
    ...over,
  };
}

function baseMessages(task: string): Message[] {
  return [
    { role: 'system', content: buildSystemPrompt(dir) },
    { role: 'user', content: task },
  ];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zent-e2e-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('mock e2e: read → edit → run_shell → finish', () => {
  test('completes a multi-step coding task', async () => {
    writeFileSync(join(dir, 'add.ts'), 'export function add(a: number, b: number) {\n  return a + b;\n}\n');
    writeFileSync(join(dir, 'add.test.ts'), "import { add } from './add';\ntest('add', () => { expect(add(2, 3)).toBe(5); });\n");

    const client = mockClientFromScript([
      { tool: { name: 'read_file', args: { path: 'add.ts' } } },
      { tool: { name: 'edit_file', args: { path: 'add.ts', old_string: '  return a + b;', new_string: '  return a + b;\n}\n\nexport function sub(a: number, b: number) {\n  return a - b;' } } },
      { tool: { name: 'run_shell', args: { command: 'bun test add.test.ts' } } },
      { tool: { name: 'finish', args: { summary: 'done' } } },
    ]);

    const events = await driveAgent(
      runAgent({ messages: baseMessages('add sub'), client, config: config({ approvalMode: 'full-auto' }), signal: new AbortController().signal, tools: registry }),
    );

    const types = events.map((e) => e.type);
    expect(types).toContain('tool_start');
    expect(types).toContain('tool_end');
    expect(types).toContain('finish');
    expect(readFileSync(join(dir, 'add.ts'), 'utf8')).toContain('export function sub');
  });

  test('edit_file fuzzy matching works (B1)', async () => {
    writeFileSync(join(dir, 'fuzzy.ts'), '    function foo() {\n        return 1;\n    }');

    const client = mockClientFromScript([
      { tool: { name: 'edit_file', args: { path: 'fuzzy.ts', old_string: '  function foo() {\n      return 1;\n  }', new_string: '  function bar() {\n      return 2;\n  }' } } },
      { tool: { name: 'finish', args: { summary: 'ok' } } },
    ]);

    const events = await driveAgent(
      runAgent({ messages: baseMessages('edit'), client, config: config({ approvalMode: 'full-auto' }), signal: new AbortController().signal, tools: registry }),
    );

    const editEnd = events.find((e) => e.type === 'tool_end' && e.name === 'edit_file');
    expect(editEnd).toBeDefined();
    expect((editEnd as { ok: boolean }).ok).toBe(true);
    expect(readFileSync(join(dir, 'fuzzy.ts'), 'utf8')).toContain('function bar');
  });

  test('full-auto skips approval (B2)', async () => {
    const client = mockClientFromScript([
      { tool: { name: 'write_file', args: { path: 'x.txt', content: 'x' } } },
      { tool: { name: 'finish', args: { summary: 'ok' } } },
    ]);

    const events = await driveAgent(
      runAgent({ messages: baseMessages('write'), client, config: config({ approvalMode: 'full-auto' }), signal: new AbortController().signal, tools: registry }),
    );

    expect(events.some((e) => e.type === 'approval_required')).toBe(false);
    expect(events.some((e) => e.type === 'finish')).toBe(true);
  });

  test('suggest pauses at first dangerous call (B2)', async () => {
    const client = mockClientFromScript([
      { tool: { name: 'update_plan', args: { steps: [{ title: 'write', status: 'running' }] } } },
      { tool: { name: 'write_file', args: { path: 'x.txt', content: 'x' } } },
      { tool: { name: 'finish', args: { summary: 'ok' } } },
    ]);

    const events = await driveAgent(
      runAgent({ messages: baseMessages('write'), client, config: config({ approvalMode: 'suggest' }), signal: new AbortController().signal, tools: registry }),
      (e) => (e.type === 'suggest_plan_approval' ? { approved: true } : undefined),
    );

    expect(events.some((e) => e.type === 'suggest_plan_approval')).toBe(true);
    expect(events.some((e) => e.type === 'approval_required')).toBe(false);
    expect(events.some((e) => e.type === 'finish')).toBe(true);
  });

  test('dangerous shell commands are blocked (B3)', async () => {
    const client = mockClientFromScript([
      { tool: { name: 'run_shell', args: { command: 'rm -rf /' } } },
      { tool: { name: 'finish', args: { summary: 'ok' } } },
    ]);

    const events = await driveAgent(
      runAgent({ messages: baseMessages('danger'), client, config: config({ approvalMode: 'full-auto' }), signal: new AbortController().signal, tools: registry }),
    );

    const shellEnd = events.find((e) => e.type === 'tool_end' && e.name === 'run_shell');
    expect(shellEnd).toBeDefined();
    expect((shellEnd as { ok: boolean }).ok).toBe(false);
    expect((shellEnd as { full: string }).full).toContain('安全');
  });
});

describe('mock e2e: summarization (B4)', () => {
  test('long conversation triggers summary compression', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task' },
    ];
    // Add enough long messages to push token estimate over threshold
    for (let i = 0; i < 20; i++) {
      messages.push({ role: 'assistant', content: `ack ${i} ` + 'y'.repeat(300) });
      messages.push({ role: 'user', content: `task ${i + 1} ` + 'x'.repeat(300) });
    }

    const client = mockClientFromScript([
      { content: 'summary text' },
      { tool: { name: 'finish', args: { summary: 'done' } } },
    ]);

    const cfg = config({ contextWindow: 1000, enableSummarization: true, keepRecentTurns: 4 });
    const events = await driveAgent(
      runAgent({ messages, client, config: cfg, signal: new AbortController().signal, tools: registry }),
    );

    // The summary mock returns content but no tool call on first iteration; finish is on second.
    expect(events.some((e) => e.type === 'finish')).toBe(true);
  });
});
