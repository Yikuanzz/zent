import React from 'react';
import { render } from 'ink';
import { ConversationView } from '../src/tui/ConversationView.tsx';
import type { DisplayItem } from '../src/tui/types.ts';

const items: DisplayItem[] = [
  { kind: 'user', id: 1, text: '帮我修复 add 函数的测试' },
  { kind: 'assistant', id: 2, text: '我先列个计划，然后读测试文件。', done: true },
  {
    kind: 'plan',
    id: 3,
    steps: [
      { title: '读取测试与源码', status: 'done' },
      { title: '修复 add 实现', status: 'running' },
      { title: '运行 bun test 验证', status: 'pending' },
    ],
  },
  {
    kind: 'tool',
    id: 4,
    callId: 'c1',
    name: 'read_file',
    args: { path: 'src/add.ts' },
    status: 'ok',
    summary: '读取 src/add.ts (12 行)',
    full: 'export function add(a,b){return a-b}',
    durationMs: 8,
    collapsed: true,
  },
  {
    kind: 'tool',
    id: 5,
    callId: 'c2',
    name: 'run_shell',
    args: { command: 'bun test' },
    status: 'failed',
    summary: '执行失败 (exit 1): bun test',
    full: '1 fail\nexpected 3 got -1',
    durationMs: 1240,
    collapsed: false,
  },
  {
    kind: 'finish',
    id: 6,
    text: '已修复 `add`：把 `a-b` 改成 `a+b`。\n\n```ts\nexport function add(a: number, b: number) {\n  return a + b;\n}\n```\n\n测试现在全部通过。',
  },
];

const inst = render(<ConversationView items={items} selectedId={4} reviewMode={true} />);
await new Promise((r) => setTimeout(r, 120));
inst.unmount();
console.log('\n[cv-smoke] done');
process.exit(0);
