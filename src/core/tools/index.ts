/**
 * Tool registry: explicit name → Tool mapping. Add a tool = add a file + one
 * line here. The loop looks tools up by name; the schemas are sent to the model.
 */
import type { JSONSchema, Tool } from '../types.ts';
import { readFileTool } from './readFile.ts';
import { writeFileTool } from './writeFile.ts';
import { editFileTool } from './editFile.ts';
import { runShellTool } from './runShell.ts';
import { updatePlanTool } from './updatePlan.ts';
import { finishTool } from './finish.ts';

export const registry: Record<string, Tool> = {
  read_file: readFileTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  run_shell: runShellTool,
  update_plan: updatePlanTool,
  finish: finishTool,
};

export function getTool(name: string): Tool | undefined {
  return registry[name];
}

/** Tool specs (name/description/schema) to pass to the model's `tools` param. */
export function toolSpecs(): { name: string; description: string; schema: JSONSchema }[] {
  return Object.values(registry).map((t) => ({
    name: t.name,
    description: t.description,
    schema: t.schema,
  }));
}
