/**
 * Headless driver for the agent loop — NO UI. This is the primary place to
 * validate the loop, tune the prompt, and debug, proving that core/ runs fully
 * decoupled from the TUI.
 *
 * Usage:
 *   bun run scripts/runHeadless.ts "<task>"
 *   bun run scripts/runHeadless.ts --auto "<task>"   # auto-approve dangerous tools
 */
import { runAgent } from '../src/core/agent.ts';
import { createLLMClient } from '../src/core/providers/index.ts';
import { registry } from '../src/core/tools/index.ts';
import { buildSystemPrompt } from '../src/core/prompt.ts';
import { loadConfig, ConfigError } from '../src/config.ts';
import type { AgentEvent, ApprovalDecision, Message } from '../src/core/types.ts';

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

async function main() {
  const argv = process.argv.slice(2);
  const auto = argv.includes('--auto');
  const task = argv.filter((a) => a !== '--auto').join(' ').trim();
  if (!task) {
    console.error('用法: bun run scripts/runHeadless.ts [--auto] "<任务描述>"');
    process.exit(1);
  }

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(red(e.message));
      process.exit(1);
    }
    throw e;
  }

  const client = createLLMClient(config);
  const messages: Message[] = [
    { role: 'system', content: buildSystemPrompt(config.cwd) },
    { role: 'user', content: task },
  ];

  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());

  const gen = runAgent({ messages, client, config, signal: controller.signal, tools: registry });

  let pending: ApprovalDecision = undefined;
  let streaming = false;

  while (true) {
    const { value: event, done } = await gen.next(pending);
    pending = undefined;
    if (done || !event) break;

    const e = event as AgentEvent;
    switch (e.type) {
      case 'turn_start':
        process.stdout.write(dim(`\n── turn ${e.iteration} ──\n`));
        break;
      case 'thinking':
        if (!streaming) {
          process.stdout.write(dim('> '));
          streaming = true;
        }
        process.stdout.write(dim(e.delta));
        break;
      case 'assistant_message':
        if (streaming) {
          process.stdout.write('\n');
          streaming = false;
        }
        break;
      case 'tool_start':
        process.stdout.write(`${cyan('[Tool]')} ${e.call.name}(${JSON.stringify(e.call.args)})\n`);
        break;
      case 'approval_required': {
        if (auto) {
          console.log(dim('  (--auto) 自动批准'));
          pending = { approved: true };
        } else {
          const answer = prompt(`  审批 ${e.call.name}? [y/N]`);
          pending = { approved: (answer ?? '').trim().toLowerCase() === 'y' };
        }
        break;
      }
      case 'tool_denied':
        console.log(red(`  已拒绝: ${e.call.name}`));
        break;
      case 'tool_end':
        console.log(
          `  ${e.ok ? green('✔') : red('✘')} ${e.summary}\n` +
            dim(indent(e.full.length > 500 ? e.full.slice(0, 500) + ' …' : e.full)),
        );
        break;
      case 'plan_update':
        console.log(cyan('  [Plan]'));
        e.steps.forEach((s, i) => console.log(`    ${i + 1}. [${s.status}] ${s.title}`));
        break;
      case 'token_usage':
        console.log(dim(`  tokens: prompt=${e.usage.prompt} completion=${e.usage.completion} total=${e.usage.total}`));
        break;
      case 'finish':
        console.log(green(`\n✔ finish: ${e.summary}`));
        break;
      case 'error':
        console.log(red(`\n✘ error: ${e.message}`));
        break;
      case 'aborted':
        console.log(red('\n✘ aborted'));
        break;
    }
  }
}

function indent(s: string): string {
  return s.split('\n').map((l) => '    ' + l).join('\n');
}

main().catch((e) => {
  console.error(red(String(e?.stack ?? e)));
  process.exit(1);
});
