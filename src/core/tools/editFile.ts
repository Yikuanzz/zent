/**
 * edit_file: string replacement with fuzzy matching for indentation /
 * trailing-whitespace / leading-trailing blank-line differences.
 *
 * Matching semantics (design §4):
 *   - normalize old_string and candidate locations in the file
 *   - 0 matches  → error, ask the model to read_file and retry.
 *   - >1 matches → error, ask for a longer unique snippet.
 *   - 1 match    → replace the original located text, return a short diff summary.
 *
 * Dangerous (side effect) — requires approval.
 */
import { readFile, writeFile } from 'node:fs/promises';
import type { Tool, ToolResult } from '../types.ts';
import { resolveInCwd } from './pathSafe.ts';

function normalizeLine(line: string): string {
  // CR is stripped so \r\n and \n are equivalent.
  return line.replace(/\r$/, '').trimEnd();
}

function commonIndent(lines: string[]): number {
  let min = Infinity;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const leading = line.length - line.trimStart().length;
    if (leading < min) min = leading;
  }
  return min === Infinity ? 0 : min;
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') start++;
  while (end > start && lines[end - 1] === '') end--;
  return lines.slice(start, end);
}

/** Return a line signature that ignores trailing blanks, line endings,
 * leading/trailing blank lines, and uniform indentation differences. */
function normalizeBlock(text: string): string[] {
  const lines = text.split(/\r?\n/).map(normalizeLine);
  const trimmed = trimBlankEdges(lines);
  if (trimmed.length === 0) return [];
  const indent = commonIndent(trimmed);
  if (indent === 0) return trimmed;
  return trimmed.map((line) => (line === '' ? '' : line.slice(indent)));
}

function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

interface FuzzyMatch {
  startLine: number;
  endLine: number;
  startCol: number; // inclusive, meaningful when startLine === endLine
  endCol: number;   // exclusive, meaningful when startLine === endLine
}

function findFuzzyMatches(content: string, oldStr: string): FuzzyMatch[] {
  const oldLines = normalizeBlock(oldStr);
  if (oldLines.length === 0) return [];

  const fileLines = content.split(/\r?\n/).map(normalizeLine);
  const matches: FuzzyMatch[] = [];

  if (oldLines.length === 1) {
    const needle = oldLines[0]!;
    for (let i = 0; i < fileLines.length; i++) {
      const line = fileLines[i];
      let idx = line.indexOf(needle);
      while (idx !== -1) {
        matches.push({ startLine: i, endLine: i, startCol: idx, endCol: idx + needle.length });
        idx = line.indexOf(needle, idx + needle.length);
      }
    }
    return matches;
  }

  for (let i = 0; i <= fileLines.length - oldLines.length; i++) {
    const window = fileLines.slice(i, i + oldLines.length);
    const normWindow = normalizeBlock(window.join('\n'));
    if (arraysEqual(normWindow, oldLines)) {
      matches.push({ startLine: i, endLine: i + oldLines.length - 1, startCol: 0, endCol: 0 });
    }
  }
  return matches;
}

/** Build a compact diff summary: which line range changed, +N/-M line counts. */
function diffSummary(startLine: number, oldStr: string, newStr: string): string {
  const removed = oldStr.split('\n').length;
  const added = newStr.split('\n').length;
  return `第 ${startLine + 1} 行附近: -${removed} 行 / +${added} 行`;
}

/** Split content into lines while preserving the exact line separators. */
function splitLinesWithSeparators(text: string): { lines: string[]; separators: string[] } {
  const lines: string[] = [];
  const separators: string[] = [];
  const re = /\r?\n/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    lines.push(text.slice(lastIndex, m.index));
    separators.push(m[0]);
    lastIndex = m.index + m[0].length;
  }
  lines.push(text.slice(lastIndex));
  return { lines, separators };
}

/** Extract the original snippet from the located range and replace it. */
function replaceLines(content: string, match: FuzzyMatch, newStr: string): string {
  const { lines, separators } = splitLinesWithSeparators(content);
  if (match.startLine === match.endLine) {
    const line = lines[match.startLine]!;
    lines[match.startLine] = line.slice(0, match.startCol) + newStr + line.slice(match.endCol);
    return lines.map((line, i) => line + (separators[i] ?? '')).join('');
  }

  const snippetLines = lines.slice(match.startLine, match.endLine + 1);
  const snippetSeps = separators.slice(match.startLine, match.endLine);
  const snippet = snippetLines.map((line, i) => line + (snippetSeps[i] ?? '')).join('');
  const beforeLines = lines.slice(0, match.startLine);
  const beforeSeps = separators.slice(0, match.startLine);
  const before = beforeLines.map((line, i) => line + (beforeSeps[i] ?? '')).join('');
  const startIdx = before.length;
  return content.slice(0, startIdx) + newStr + content.slice(startIdx + snippet.length);
}

export const editFileTool: Tool = {
  name: 'edit_file',
  description:
    '通过字符串替换编辑文件。old_string 必须能唯一匹配文件中的一段文本；允许缩进、行尾空白、首尾空行、换行符的轻微差异。' +
    '若匹配 0 次或多次会报错。',
  dangerous: true,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对于工作目录的文件路径' },
      old_string: { type: 'string', description: '要被替换的原文片段（需唯一；缩进/空白可宽容匹配）' },
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

    const matches = findFuzzyMatches(content, oldStr);
    if (matches.length === 0) {
      return {
        ok: false,
        summary: `未匹配: ${p}`,
        full: `在 ${p} 中未找到 old_string。请先用 read_file 确认原文（允许轻微缩进/空白差异）后重试。`,
      };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        summary: `匹配 ${matches.length} 处: ${p}`,
        full: `old_string 在 ${p} 中匹配了 ${matches.length} 处，存在歧义。请提供包含更多上下文的、能唯一定位的更长片段。`,
      };
    }

    const match = matches[0]!;
    const updated = replaceLines(content, match, newStr);
    const summary = diffSummary(match.startLine, oldStr, newStr);
    try {
      await writeFile(abs, updated, 'utf8');
    } catch (e) {
      return { ok: false, summary: `写入失败: ${p}`, full: `写入 ${p} 失败: ${(e as Error).message}` };
    }
    return { ok: true, summary: `编辑 ${p} (${summary})`, full: `已编辑 ${p}：${summary}` };
  },
};
