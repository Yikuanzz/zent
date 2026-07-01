import { test, expect, describe } from 'bun:test';
import { runAgent } from '../../src/core/agent.ts';
import type {
  AgentEvent,
  ApprovalDecision,
  ChatChunk,
  Config,
  LLMClient,
  Message,
  Tool,
} from '../../src/core/types.ts';

// ── Mock provider ────────────────────────────────────────────────────────────
// Each "scripted turn" is either plain content or a single tool call. The mock
// emits the matching ChatChunk fragments for the current turn index.
type ScriptedTurn = { content?: string; tool?: { name: string; args: Record<string, unknown> } };

function mockClient(script: ScriptedTurn[]): LLMClient {
  let turn = 0;
  return {
    async *streamChat(): AsyncIterable<ChatChunk> {
      const t = script[Math.min(turn, script.length - 1)]!;
      turn++;
      if (t.content) yield { contentDelta: t.content };
      if (t.tool) {
        yield { toolCallDelta: { index: 0, id: `call_${turn}`, name: t.tool.name } };
        yield { toolCallDelta: { index: 0, argsDelta: JSON.stringify(t.tool.args) } };
      }
      yield { usage: { prompt: 10, completion: 5, total: 15 } };
    },
  };
}

function makeConfig(over: Partial<Config> = {}): Config {
  return {
    baseUrl: 'x',
    apiKey: 'x',
    model: 'm',
    maxIterations: 25,
    maxToolOutputChars: 4000,
    keepRecentTurns: 50,
    contextWindow: 128000,
    cwd: process.cwd(),
    approvalMode: 'manual',
    shellSafety: 'strict',
    shellBlacklist: [],
    shellWhitelist: [],
    allowShellRedirectOutsideCwd: false,
    ...over,
  };
}

// A trivial fake tool set so we don't touch the filesystem.
function fakeTools(): Record<string, Tool> {
  const echo: Tool = {
    name: 'echo',
    description: 'echo',
    dangerous: false,
    schema: { type: 'object', properties: {} },
    async run(args) {
      return { ok: true, summary: 'echoed', full: `echo:${JSON.stringify(args)}` };
    },
  };
  const danger: Tool = {
    name: 'danger',
    description: 'danger',
    dangerous: true,
    schema: { type: 'object', properties: {} },
    async run() {
      return { ok: true, summary: 'did danger', full: 'danger done' };
    },
  };
  const boom: Tool = {
    name: 'boom',
    description: 'boom',
    dangerous: false,
    schema: { type: 'object', properties: {} },
    async run() {
      throw new Error('kaboom');
    },
  };
  const finish: Tool = {
    name: 'finish',
    description: 'finish',
    dangerous: false,
    schema: { type: 'object', properties: {} },
    async run(args) {
      return { ok: true, summary: 'done', full: String(args.summary ?? '') };
    },
  };
  const updatePlan: Tool = {
    name: 'update_plan',
    description: 'plan',
    dangerous: false,
    schema: { type: 'object', properties: {} },
    async run(args) {
      const steps = (args.steps as Array<{ title: string; status: string }>) ?? [];
      return { ok: true, summary: 'plan updated', full: 'plan', plan: steps.map((s) => ({ title: s.title, status: s.status as any })) };
    },
  };
  return { echo, danger, boom, finish, update_plan: updatePlan };
}

/** Drive the generator to completion, optionally answering approvals. */
async function drive(
  gen: AsyncGenerator<AgentEvent, void, ApprovalDecision>,
  approve: boolean,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  let pending: ApprovalDecision = undefined;
  while (true) {
    const { value, done } = await gen.next(pending);
    pending = undefined;
    if (done || !value) break;
    events.push(value);
    if (value.type === 'approval_required') pending = { approved: approve };
  }
  return events;
}

function baseMessages(): Message[] {
  return [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'task' },
  ];
}

describe('runAgent loop', () => {
  test('echo then finish → correct event sequence + termination', async () => {
    const client = mockClient([
      { content: 'thinking', tool: { name: 'echo', args: { x: 1 } } },
      { tool: { name: 'finish', args: { summary: 'all done' } } },
    ]);
    const messages = baseMessages();
    const gen = runAgent({
      messages,
      client,
      config: makeConfig(),
      signal: new AbortController().signal,
      tools: fakeTools(),
    });
    const events = await drive(gen, true);
    const types = events.map((e) => e.type);

    expect(types).toContain('tool_start');
    expect(types).toContain('tool_end');
    const finish = events.find((e) => e.type === 'finish');
    expect(finish).toBeDefined();
    expect((finish as { summary: string }).summary).toBe('all done');
    // tool result observations are appended to history
    expect(messages.some((m) => m.role === 'tool')).toBe(true);
  });

  test('dangerous tool emits approval_required; approve runs it', async () => {
    const client = mockClient([
      { tool: { name: 'danger', args: {} } },
      { tool: { name: 'finish', args: { summary: 'ok' } } },
    ]);
    const gen = runAgent({
      messages: baseMessages(),
      client,
      config: makeConfig(),
      signal: new AbortController().signal,
      tools: fakeTools(),
    });
    const events = await drive(gen, true);
    expect(events.some((e) => e.type === 'approval_required')).toBe(true);
    const end = events.find((e) => e.type === 'tool_end');
    expect((end as { ok: boolean }).ok).toBe(true);
  });

  test('dangerous tool denied → tool_denied, not executed', async () => {
    const client = mockClient([
      { tool: { name: 'danger', args: {} } },
      { tool: { name: 'finish', args: { summary: 'ok' } } },
    ]);
    const messages = baseMessages();
    const gen = runAgent({
      messages,
      client,
      config: makeConfig(),
      signal: new AbortController().signal,
      tools: fakeTools(),
    });
    const events = await drive(gen, false);
    expect(events.some((e) => e.type === 'tool_denied')).toBe(true);
    expect(messages.some((m) => m.role === 'tool' && String(m.content).includes('拒绝'))).toBe(true);
  });

  test('tool throwing → error captured as observation, loop continues to finish', async () => {
    const client = mockClient([
      { tool: { name: 'boom', args: {} } },
      { tool: { name: 'finish', args: { summary: 'recovered' } } },
    ]);
    const messages = baseMessages();
    const gen = runAgent({
      messages,
      client,
      config: makeConfig(),
      signal: new AbortController().signal,
      tools: fakeTools(),
    });
    const events = await drive(gen, true);
    const end = events.find((e) => e.type === 'tool_end' && e.name === 'boom');
    expect(end).toBeDefined();
    expect((end as { ok: boolean }).ok).toBe(false);
    expect(events.some((e) => e.type === 'finish')).toBe(true);
  });

  test('max_iterations reached → forced finish', async () => {
    // Always echo, never finish.
    const client = mockClient([{ tool: { name: 'echo', args: {} } }]);
    const gen = runAgent({
      messages: baseMessages(),
      client,
      config: makeConfig({ maxIterations: 3 }),
      signal: new AbortController().signal,
      tools: fakeTools(),
    });
    const events = await drive(gen, true);
    const turnStarts = events.filter((e) => e.type === 'turn_start');
    expect(turnStarts).toHaveLength(3);
    const finish = events.find((e) => e.type === 'finish');
    expect((finish as { summary: string }).summary).toContain('最大迭代');
  });

  test('full-auto: dangerous tool runs without approval_required', async () => {
    const client = mockClient([
      { tool: { name: 'danger', args: {} } },
      { tool: { name: 'finish', args: { summary: 'ok' } } },
    ]);
    const gen = runAgent({
      messages: baseMessages(),
      client,
      config: makeConfig({ approvalMode: 'full-auto' }),
      signal: new AbortController().signal,
      tools: fakeTools(),
    });
    const events = await drive(gen, false); // never answer approvals
    expect(events.some((e) => e.type === 'approval_required')).toBe(false);
    expect(events.some((e) => e.type === 'suggest_plan_approval')).toBe(false);
    const end = events.find((e) => e.type === 'tool_end' && e.name === 'danger');
    expect((end as { ok: boolean }).ok).toBe(true);
  });

  test('suggest: read-only tools run freely; first dangerous yields suggest_plan_approval', async () => {
    const client = mockClient([
      { tool: { name: 'update_plan', args: { steps: [{ title: 'step1', status: 'pending' }] } } },
      { tool: { name: 'danger', args: {} } },
      { tool: { name: 'danger', args: {} } },
      { tool: { name: 'finish', args: { summary: 'ok' } } },
    ]);
    const gen = runAgent({
      messages: baseMessages(),
      client,
      config: makeConfig({ approvalMode: 'suggest' }),
      signal: new AbortController().signal,
      tools: fakeTools(),
    });

    const events: AgentEvent[] = [];
    let pending: ApprovalDecision = undefined;
    while (true) {
      const { value, done } = await gen.next(pending);
      pending = undefined;
      if (done || !value) break;
      events.push(value);
      if (value.type === 'suggest_plan_approval') {
        expect(value.plan).toHaveLength(1);
        expect(value.nextCall.name).toBe('danger');
        pending = { approved: true };
      }
    }

    const suggestEvents = events.filter((e) => e.type === 'suggest_plan_approval');
    expect(suggestEvents).toHaveLength(1);
    const dangerEnds = events.filter((e) => e.type === 'tool_end' && e.name === 'danger');
    expect(dangerEnds).toHaveLength(2);
  });

  test('pre-aborted signal → aborted event, no model call', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = mockClient([{ tool: { name: 'finish', args: { summary: 'x' } } }]);
    const gen = runAgent({
      messages: baseMessages(),
      client,
      config: makeConfig(),
      signal: controller.signal,
      tools: fakeTools(),
    });
    const events = await drive(gen, true);
    expect(events.some((e) => e.type === 'aborted')).toBe(true);
  });
});
