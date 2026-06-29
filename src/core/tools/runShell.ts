/**
 * run_shell: execute a shell command in the working directory.
 * Captures stdout/stderr/exit code. Non-zero exit → ok:false, but the output
 * is still fed back as an observation (the loop does not abort on failure).
 *
 * Dangerous (arbitrary side effects) — requires approval.
 */
import { spawn } from 'node:child_process';
import type { Tool, ToolResult } from '../types.ts';

function runCommand(
  command: string,
  cwd: string,
  signal: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // Use the platform shell so the model can write normal shell syntax.
    const isWin = process.platform === 'win32';
    const child = isWin
      ? spawn(command, { cwd, shell: true, signal })
      : spawn('sh', ['-c', command], { cwd, signal });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', (e) => resolve({ code: -1, stdout, stderr: stderr + String(e) }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export const runShellTool: Tool = {
  name: 'run_shell',
  description: '在工作目录中执行一条 shell 命令，返回 stdout/stderr 与退出码。用于运行测试、构建、git 等。',
  dangerous: true,
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的 shell 命令' },
    },
    required: ['command'],
    additionalProperties: false,
  },
  async run(args, ctx): Promise<ToolResult> {
    const command = String(args.command ?? '');
    if (!command) return { ok: false, summary: '缺少 command 参数', full: '错误: 必须提供 command 参数' };
    const { code, stdout, stderr } = await runCommand(command, ctx.cwd, ctx.signal);
    const ok = code === 0;
    const full =
      `$ ${command}\n` +
      (stdout ? `[stdout]\n${stdout}\n` : '') +
      (stderr ? `[stderr]\n${stderr}\n` : '') +
      `[exit] ${code}`;
    const summary = ok ? `执行成功 (exit 0): ${command}` : `执行失败 (exit ${code}): ${command}`;
    return { ok, summary, full };
  },
};
