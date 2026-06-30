/**
 * ApprovalPrompt: a selectable confirmation menu for dangerous tools, in the
 * style of Claude Code's permission prompt. Navigated with ↑/↓ + Enter
 * (App owns the key handling); y/n are also accepted as shortcuts.
 *
 *   Run this command?
 *     git push origin main
 *
 *   > 1. Yes
 *     2. Yes, and don't ask again for run_shell this session
 *     3. No
 */
import React from 'react';
import { Box, Text } from 'ink';
import type { ToolCall } from '../core/types.ts';

const ACCENT = '#d79921';

const TITLES: Record<string, string> = {
  run_shell: 'Run this command?',
  write_file: 'Write this file?',
  edit_file: 'Apply this edit?',
};

export const APPROVAL_OPTIONS = (toolName: string) => [
  'Yes',
  `Yes, and don't ask again for ${toolName} this session`,
  'No',
];

/** The most relevant detail to show for the pending action. */
function detail(call: ToolCall): string {
  const a = call.args as Record<string, unknown>;
  if (typeof a.command === 'string') return a.command;
  if (typeof a.path === 'string') return a.path;
  return JSON.stringify(a);
}

export function ApprovalPrompt({ call, selected }: { call: ToolCall; selected: number }) {
  const title = TITLES[call.name] ?? `Run ${call.name}?`;
  const options = APPROVAL_OPTIONS(call.name);
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={ACCENT}>{title}</Text>
      <Box marginY={0} paddingLeft={1}>
        <Text color="#d5c4a1">{detail(call)}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {options.map((opt, i) => {
          const active = i === selected;
          return (
            <Text key={i} color={active ? ACCENT : undefined} dimColor={!active}>
              {active ? '> ' : '  '}
              {i + 1}. {opt}
            </Text>
          );
        })}
      </Box>
      <Text dimColor>↑/↓ select · enter confirm · y/n shortcut</Text>
    </Box>
  );
}
