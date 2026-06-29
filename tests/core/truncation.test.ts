import { test, expect, describe } from 'bun:test';
import { truncateOutput, truncateHistory } from '../../src/core/context/truncation.ts';
import type { Message } from '../../src/core/types.ts';

describe('truncateOutput (D)', () => {
  test('keeps short text unchanged', () => {
    expect(truncateOutput('hello', 4000)).toBe('hello');
  });
  test('truncates long text with head+tail marker', () => {
    const long = 'a'.repeat(10000);
    const out = truncateOutput(long, 1000);
    expect(out.length).toBeLessThan(1100);
    expect(out).toContain('已截断');
    expect(out.startsWith('a')).toBe(true);
    expect(out.endsWith('a')).toBe(true);
  });
});

describe('truncateHistory (B)', () => {
  const sys: Message = { role: 'system', content: 'SYS' };
  function turns(n: number): Message[] {
    const out: Message[] = [sys];
    for (let i = 0; i < n; i++) out.push({ role: 'user', content: `u${i}` });
    return out;
  }

  test('keeps everything when under window', () => {
    const m = turns(3);
    expect(truncateHistory(m, 20)).toEqual(m);
  });

  test('always keeps system message', () => {
    const m = turns(50);
    const out = truncateHistory(m, 10);
    expect(out[0]).toEqual(sys);
    expect(out.length).toBeLessThan(m.length);
  });

  test('does not start window on an orphan tool message', () => {
    const m: Message[] = [
      sys,
      { role: 'user', content: 'task' },
      { role: 'assistant', content: null, tool_calls: [{ id: 't1', name: 'read_file', args: {} }] },
      { role: 'tool', tool_call_id: 't1', name: 'read_file', content: 'result' },
      { role: 'assistant', content: 'done' },
    ];
    // keepRecentTurns=2 would naively start at the tool message; must walk back
    // to include its assistant parent.
    const out = truncateHistory(m, 2);
    const firstNonSystem = out[1];
    expect(firstNonSystem?.role).not.toBe('tool');
  });
});
