import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileTool } from '../../src/core/tools/readFile.ts';
import { writeFileTool } from '../../src/core/tools/writeFile.ts';
import { editFileTool } from '../../src/core/tools/editFile.ts';
import { runShellTool } from '../../src/core/tools/runShell.ts';
import { updatePlanTool } from '../../src/core/tools/updatePlan.ts';
import type { Config, ToolContext } from '../../src/core/types.ts';

let dir: string;
function ctx(): ToolContext {
  const config = { cwd: dir, maxToolOutputChars: 4000 } as Config;
  return { cwd: dir, signal: new AbortController().signal, config };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cc-tools-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('read_file', () => {
  test('reads existing file', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello\nworld');
    const r = await readFileTool.run({ path: 'a.txt' }, ctx());
    expect(r.ok).toBe(true);
    expect(r.full).toBe('hello\nworld');
  });
  test('missing file → ok:false observation', async () => {
    const r = await readFileTool.run({ path: 'nope.txt' }, ctx());
    expect(r.ok).toBe(false);
    expect(r.full).toContain('失败');
  });
});

describe('write_file', () => {
  test('creates file and nested dirs', async () => {
    const r = await writeFileTool.run({ path: 'sub/b.txt', content: 'x' }, ctx());
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, 'sub/b.txt'), 'utf8')).toBe('x');
  });
});

describe('edit_file (strict match, 3 branches)', () => {
  test('1 match → replaces + diff summary', async () => {
    writeFileSync(join(dir, 'c.txt'), 'foo bar baz');
    const r = await editFileTool.run({ path: 'c.txt', old_string: 'bar', new_string: 'BAR' }, ctx());
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, 'c.txt'), 'utf8')).toBe('foo BAR baz');
  });
  test('0 matches → error', async () => {
    writeFileSync(join(dir, 'c.txt'), 'foo');
    const r = await editFileTool.run({ path: 'c.txt', old_string: 'zzz', new_string: 'x' }, ctx());
    expect(r.ok).toBe(false);
    expect(r.full).toContain('未找到');
  });
  test('multiple matches → error asking for unique context', async () => {
    writeFileSync(join(dir, 'c.txt'), 'x x x');
    const r = await editFileTool.run({ path: 'c.txt', old_string: 'x', new_string: 'y' }, ctx());
    expect(r.ok).toBe(false);
    expect(r.full).toContain('匹配');
  });
});

describe('edit_file (fuzzy match)', () => {
  test('indentation difference: uniform offset still matches', async () => {
    writeFileSync(join(dir, 'd.txt'), '    function foo() {\n        return 1;\n    }');
    const r = await editFileTool.run(
      { path: 'd.txt', old_string: '  function foo() {\n      return 1;\n  }', new_string: '  function bar() {\n      return 2;\n  }' },
      ctx(),
    );
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, 'd.txt'), 'utf8')).toBe('  function bar() {\n      return 2;\n  }');
  });
  test('trailing whitespace ignored', async () => {
    writeFileSync(join(dir, 'e.txt'), 'hello world');
    const r = await editFileTool.run(
      { path: 'e.txt', old_string: 'hello world   ', new_string: 'hello WORLD' },
      ctx(),
    );
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, 'e.txt'), 'utf8')).toBe('hello WORLD');
  });
  test('leading/trailing blank lines ignored', async () => {
    writeFileSync(join(dir, 'f.txt'), 'a\nb\nc');
    const r = await editFileTool.run(
      { path: 'f.txt', old_string: '\n\nb\n\n', new_string: 'B' },
      ctx(),
    );
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, 'f.txt'), 'utf8')).toBe('a\nB\nc');
  });
  test('CRLF vs LF equivalence', async () => {
    writeFileSync(join(dir, 'g.txt'), 'line1\r\nline2\r\nline3');
    const r = await editFileTool.run(
      { path: 'g.txt', old_string: 'line1\nline2', new_string: 'LINE1\nLINE2' },
      ctx(),
    );
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, 'g.txt'), 'utf8')).toBe('LINE1\nLINE2\r\nline3');
  });
  test('multiple fuzzy matches still error', async () => {
    writeFileSync(join(dir, 'h.txt'), '  x\n  x\n  x');
    const r = await editFileTool.run(
      { path: 'h.txt', old_string: 'x\n', new_string: 'y\n' },
      ctx(),
    );
    expect(r.ok).toBe(false);
    expect(r.full).toContain('匹配');
    expect(r.full).toContain('更长');
  });
  test('diff summary reports line number and counts', async () => {
    writeFileSync(join(dir, 'i.txt'), 'one\ntwo\nthree');
    const r = await editFileTool.run(
      { path: 'i.txt', old_string: 'two', new_string: 'TWO\n2.5' },
      ctx(),
    );
    expect(r.ok).toBe(true);
    expect(r.summary).toContain('第 2 行');
    expect(r.summary).toContain('-1 行');
    expect(r.summary).toContain('+2 行');
  });
});

describe('run_shell', () => {
  test('captures exit 0', async () => {
    const r = await runShellTool.run({ command: 'echo hi' }, ctx());
    expect(r.ok).toBe(true);
    expect(r.full).toContain('hi');
  });
  test('non-zero exit → ok:false but still observation', async () => {
    const r = await runShellTool.run({ command: 'exit 3' }, ctx());
    expect(r.ok).toBe(false);
    expect(r.full).toContain('[exit] 3');
  });
});

describe('path safety', () => {
  test('traversal outside cwd is rejected', async () => {
    const r = await readFileTool.run({ path: '../../etc/hosts' }, ctx());
    expect(r.ok).toBe(false);
    expect(r.full).toContain('越界');
  });
});

describe('update_plan', () => {
  test('returns plan steps', async () => {
    const r = await updatePlanTool.run(
      { steps: [{ title: 'a', status: 'done' }, { title: 'b', status: 'running' }] },
      ctx(),
    );
    expect(r.ok).toBe(true);
    expect(r.plan).toHaveLength(2);
    expect(r.plan![0]!.status).toBe('done');
  });
});
