/**
 * update_plan: the model declares/updates its task plan. The plan is surfaced
 * to the UI (status panel) via the plan_update event. Read-only side-effect-wise
 * (no filesystem changes) — not dangerous.
 */
import type { PlanStep, PlanStepStatus, Tool, ToolResult } from '../types.ts';

const VALID_STATUS: PlanStepStatus[] = ['pending', 'running', 'done', 'failed'];

export const updatePlanTool: Tool = {
  name: 'update_plan',
  description:
    '声明或更新你的任务计划。任务有多步时，开工前先列出计划，并在每完成一步时更新对应步骤的状态。',
  dangerous: false,
  schema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        description: '计划步骤列表',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '步骤简述' },
            status: {
              type: 'string',
              enum: VALID_STATUS,
              description: '步骤状态: pending/running/done/failed',
            },
          },
          required: ['title', 'status'],
        },
      },
    },
    required: ['steps'],
    additionalProperties: false,
  },
  async run(args): Promise<ToolResult> {
    const rawSteps = Array.isArray(args.steps) ? args.steps : [];
    const steps: PlanStep[] = rawSteps.map((s) => {
      const obj = (s ?? {}) as Record<string, unknown>;
      const status = VALID_STATUS.includes(obj.status as PlanStepStatus)
        ? (obj.status as PlanStepStatus)
        : 'pending';
      return { title: String(obj.title ?? '(未命名步骤)'), status };
    });
    const done = steps.filter((s) => s.status === 'done').length;
    return {
      ok: true,
      summary: `计划已更新 (${done}/${steps.length} 完成)`,
      full: steps.map((s, i) => `${i + 1}. [${s.status}] ${s.title}`).join('\n'),
      plan: steps,
    };
  },
};
