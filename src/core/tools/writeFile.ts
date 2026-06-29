/**
 * write_file: overwrite (or create) a file with the given content.
 * Dangerous (side effect) — requires approval.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Tool, ToolResult } from '../types.ts';
import { resolveInCwd } from './pathSafe.ts';

export const writeFileTool: Tool = {
  name: 'write_file',
  description: '将内容完整写入文件（覆盖已有内容，必要时创建目录）。路径相对于工作目录。',
  dangerous: true,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对于工作目录的文件路径' },
      content: { type: 'string', description: '要写入的完整文件内容' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  async run(args, ctx): Promise<ToolResult> {
    const p = String(args.path ?? '');
    const content = String(args.content ?? '');
    if (!p) return { ok: false, summary: '缺少 path 参数', full: '错误: 必须提供 path 参数' };
    try {
      const abs = resolveInCwd(p, ctx.cwd);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf8');
      const lines = content.split('\n').length;
      const bytes = Buffer.byteLength(content, 'utf8');
      return {
        ok: true,
        summary: `写入 ${p} (${lines} 行, ${bytes} 字节)`,
        full: `已写入 ${p}：${lines} 行，${bytes} 字节。`,
      };
    } catch (e) {
      const msg = (e as Error).message;
      return { ok: false, summary: `写入失败: ${p}`, full: `写入 ${p} 失败: ${msg}` };
    }
  },
};
