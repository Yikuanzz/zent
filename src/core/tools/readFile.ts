/**
 * read_file: read a file's full contents. Read-only (not dangerous).
 */
import { readFile } from 'node:fs/promises';
import type { Tool, ToolResult } from '../types.ts';
import { resolveInCwd } from './pathSafe.ts';

export const readFileTool: Tool = {
  name: 'read_file',
  description: '读取指定文件的全部内容。路径相对于工作目录。',
  dangerous: false,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对于工作目录的文件路径' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  async run(args, ctx): Promise<ToolResult> {
    const p = String(args.path ?? '');
    if (!p) return { ok: false, summary: '缺少 path 参数', full: '错误: 必须提供 path 参数' };
    try {
      const abs = resolveInCwd(p, ctx.cwd);
      const content = await readFile(abs, 'utf8');
      const lines = content.split('\n').length;
      return { ok: true, summary: `读取 ${p} (${lines} 行)`, full: content };
    } catch (e) {
      const msg = (e as Error).message;
      return { ok: false, summary: `读取失败: ${p}`, full: `读取 ${p} 失败: ${msg}` };
    }
  },
};
