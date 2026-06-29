/**
 * edit_file: exact string replacement. Strict character-for-character match.
 *
 * Matching semantics (design §4):
 *   - 0 matches  → error, ask the model to read_file and retry.
 *   - >1 matches → error, ask for a longer unique snippet.
 *   - 1 match    → replace, return a short diff summary.
 *
 * Dangerous (side effect) — requires approval.
 */
import { readFile, writeFile } from 'node:fs/promises';
import type { Tool, ToolResult } from '../types.ts';
import { resolveInCwd } from './pathSafe.ts';

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/** Build a compact diff summary: which line range changed, +N/-M line counts. */
function diffSummary(before: string, oldStr: string, newStr: string): string {
  const startLine = before.slice(0, before.indexOf(oldStr)).split('\n').length;
  const removed = oldStr.split('\n').length;
  const added = newStr.split('\n').length;
  return `第 ${startLine} 行附近: -${removed} 行 / +${added} 行`;
}

export const editFileTool: Tool = {
  name: 'edit_file',
  description:
    '通过精确字符串替换编辑文件。old_string 必须与文件中的一段文本逐字符唯一匹配（含空白与缩进）。' +
    '若匹配 0 次或多次会报错。',
  dangerous: true,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对于工作目录的文件路径' },
      old_string: { type: 'string', description: '要被替换的原文片段（需唯一，含精确空白/缩进）' },
      new_string: { type: 'string', description: '替换后的新内容' },
    },
    required: ['path', 'old_string', 'new_string'],
    additionalProperties: false,
  },
  async run(args, ctx): Promise<ToolResult> {
    const p = String(args.path ?? '');
    const oldStr = typeof args.old_string === 'string' ? args.old_string : '';
    const newStr = typeof args.new_string === 'string' ? args.new_string : '';
    if (!p) return { ok: false, summary: '缺少 path 参数', full: '错误: 必须提供 path 参数' };
    if (oldStr === '') {
      return { ok: false, summary: 'old_string 为空', full: '错误: old_string 不能为空' };
    }

    let abs: string;
    let content: string;
    try {
      abs = resolveInCwd(p, ctx.cwd);
      content = await readFile(abs, 'utf8');
    } catch (e) {
      return { ok: false, summary: `读取失败: ${p}`, full: `编辑前读取 ${p} 失败: ${(e as Error).message}` };
    }

    const matches = countOccurrences(content, oldStr);
    if (matches === 0) {
      return {
        ok: false,
        summary: `未匹配: ${p}`,
        full: `在 ${p} 中未找到 old_string。请先用 read_file 确认确切原文（含空白与缩进）后重试。`,
      };
    }
    if (matches > 1) {
      return {
        ok: false,
        summary: `匹配 ${matches} 处: ${p}`,
        full: `old_string 在 ${p} 中匹配了 ${matches} 处，存在歧义。请提供包含更多上下文的、能唯一定位的更长片段。`,
      };
    }

    const updated = content.replace(oldStr, newStr);
    const summary = diffSummary(content, oldStr, newStr);
    try {
      await writeFile(abs, updated, 'utf8');
    } catch (e) {
      return { ok: false, summary: `写入失败: ${p}`, full: `写入 ${p} 失败: ${(e as Error).message}` };
    }
    return { ok: true, summary: `编辑 ${p} (${summary})`, full: `已编辑 ${p}：${summary}` };
  },
};
