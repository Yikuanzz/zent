/**
 * finish: explicit completion signal. When the model calls this, the loop
 * terminates and reports the summary. Not dangerous.
 */
import type { Tool, ToolResult } from '../types.ts';

export const finishTool: Tool = {
  name: 'finish',
  description: '任务完成且已验证后调用，给出最终总结。调用后 Agent 会停止并等待用户的下一条指令。',
  dangerous: false,
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '对已完成工作的简要总结' },
    },
    required: ['summary'],
    additionalProperties: false,
  },
  async run(args): Promise<ToolResult> {
    const summary = String(args.summary ?? '任务完成。');
    return { ok: true, summary: '任务完成', full: summary };
  },
};
