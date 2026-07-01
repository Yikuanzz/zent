import { test, expect, describe } from 'bun:test';
import { mergePlanUpdate } from '../../src/tui/useAgent.ts';
import type { DisplayItem } from '../../src/tui/types.ts';

function makeTool(id: number): DisplayItem {
  return {
    kind: 'tool',
    id,
    callId: `call-${id}`,
    name: 'read_file',
    args: { path: 'x' },
    status: 'ok',
    summary: 'ok',
    full: '',
    durationMs: 0,
    collapsed: true,
  };
}

describe('mergePlanUpdate', () => {
  let idCounter = 0;
  const nextId = () => ++idCounter;

  test('appends a plan item when none exists', () => {
    const prev: DisplayItem[] = [];
    const next = mergePlanUpdate(prev, [{ title: 'step 1', status: 'pending' }], nextId);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ kind: 'plan', steps: [{ title: 'step 1', status: 'pending' }] });
  });

  test('replaces the most recent plan item on consecutive updates', () => {
    let prev: DisplayItem[] = [];
    prev = mergePlanUpdate(prev, [{ title: 'step 1', status: 'pending' }], nextId);
    prev = mergePlanUpdate(prev, [{ title: 'step 1', status: 'running' }], nextId);
    expect(prev).toHaveLength(1);
    expect(prev[0]).toMatchObject({ kind: 'plan', steps: [{ title: 'step 1', status: 'running' }] });
  });

  test('replaces the most recent plan even when other items were inserted after it', () => {
    let prev: DisplayItem[] = [];
    prev = mergePlanUpdate(prev, [{ title: 'step 1', status: 'pending' }], nextId);
    prev = [...prev, makeTool(42)];
    prev = mergePlanUpdate(prev, [{ title: 'step 1', status: 'done' }], nextId);
    expect(prev).toHaveLength(2);
    expect(prev[0]).toMatchObject({ kind: 'plan', steps: [{ title: 'step 1', status: 'done' }] });
    expect(prev[1]).toMatchObject({ kind: 'tool', id: 42 });
  });

  test('appends a new plan after all plan items are gone', () => {
    let prev: DisplayItem[] = [];
    prev = mergePlanUpdate(prev, [{ title: 'old', status: 'done' }], nextId);
    prev = prev.filter((it) => it.kind !== 'plan');
    prev = mergePlanUpdate(prev, [{ title: 'new', status: 'pending' }], nextId);
    expect(prev).toHaveLength(1);
    expect(prev[0]).toMatchObject({ kind: 'plan', steps: [{ title: 'new', status: 'pending' }] });
  });
});
