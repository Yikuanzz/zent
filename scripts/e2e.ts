#!/usr/bin/env bun
/**
 * End-to-end headless smoke test.
 *
 * Creates a temporary workspace, writes a small TypeScript project, and asks
 * the agent to add a `sub` function and run the tests. Exits with code 0 on
 * success, 1 on failure.
 *
 * Requires a real API config (via ~/.zent/config.json or env vars) and is
 * intended to be run with --yolo to avoid interactive approvals:
 *
 *   bun run scripts/e2e.ts --yolo
 */
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../src/core/agent.ts';
import { createLLMClient } from '../src/core/providers/index.ts';
import { registry } from '../src/core/tools/index.ts';
import { buildSystemPrompt } from '../src/core/prompt.ts';
import { loadConfig } from '../src/config.ts';
import type { AgentEvent, ApprovalDecision, Message } from '../src/core/types.ts';

const task = '给 src/math/add.ts 添加一个减法函数 sub，并运行测试验证';

function parseArgs(argv: string[]): { yolo: boolean } {
  return { yolo: argv.includes('--yolo') };
}

async function main() {
  const { yolo } = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const client = createLLMClient(config);

  const dir = mkdtempSync(join(tmpdir(), 'zent-e2e-'));
  try {
    // Seed project
    const srcDir = join(dir, 'src', 'math');
    const testPath = join(dir, 'tests', 'math.test.ts');
    writeFileSync(join(srcDir, 'add.ts'), 'export function add(a: number, b: number) {\n  return a + b;\n}\n');
    writeFileSync(
      testPath,
      "import { add, sub } from '../src/math/add';\n" +
        "import { test, expect } from 'bun:test';\n" +
        "test('math', () => {\n" +
        "  expect(add(2, 3)).toBe(5);\n" +
        "  expect(sub(5, 3)).toBe(2);\n" +
        '});\n',
    );

    const messages: Message[] = [
      { role: 'system', content: buildSystemPrompt(dir) },
      { role: 'user', content: task },
    ];

    const controller = new AbortController();
    process.on('SIGINT', () => controller.abort());

    const gen = runAgent({ messages, client, config: { ...config, cwd: dir, approvalMode: 'full-auto' }, signal: controller.signal, tools: registry });

    let pending: ApprovalDecision = undefined;
    let finished = false;
    let finishSummary = '';
    let testPassed = false;
    let testOutput = '';

    while (true) {
      const { value: event, done } = await gen.next(pending);
      pending = undefined;
      if (done || !event) break;

      const e = event as AgentEvent;
      switch (e.type) {
        case 'tool_start':
          console.log(`[tool] ${e.call.name}`);
          break;
        case 'tool_end':
          console.log(`[tool_end] ${e.name} ${e.ok ? 'ok' : 'fail'}: ${e.summary}`);
          if (e.name === 'run_shell') {
            testOutput = e.full;
            testPassed = e.ok && e.full.includes('[exit] 0');
          }
          break;
        case 'finish':
          finished = true;
          finishSummary = e.summary;
          console.log(`[finish] ${e.summary}`);
          break;
        case 'error':
          console.error(`[error] ${e.message}`);
          break;
      }
    }

    const addFile = join(srcDir, 'add.ts');
    const hasSub = existsSync(addFile) && readFileSync(addFile, 'utf8').includes('export function sub');

    console.log('\n--- e2e result ---');
    console.log(`finish called: ${finished}`);
    console.log(`sub function added: ${hasSub}`);
    console.log(`tests passed: ${testPassed}`);

    if (!finished || !hasSub || !testPassed) {
      if (testOutput) console.log('\nTest output:\n' + testOutput);
      process.exit(1);
    }
    console.log('\n✔ e2e smoke passed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
