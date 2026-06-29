/**
 * StatusBar: a single thin footer line (replaces the old side panel).
 *   <tokens> tokens · <ctx bar> · <cwd> · <model>
 * All dim — ambient, never competing with the conversation.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { basename } from 'node:path';
import type { TokenUsage } from '../core/types.ts';

function shortCwd(cwd: string): string {
  const base = basename(cwd);
  return base || cwd;
}

export function StatusBar({
  usage,
  contextWindow,
  cwd,
  model,
  cost,
}: {
  usage: TokenUsage | null;
  contextWindow: number;
  cwd: string;
  model: string;
  cost: number | null;
}) {
  const used = usage?.total ?? 0;
  const pct = contextWindow > 0 ? Math.min(100, Math.round((used / contextWindow) * 100)) : 0;
  const tokenStr = used >= 1000 ? `${(used / 1000).toFixed(1)}k` : String(used);
  return (
    <Box paddingX={1}>
      <Text dimColor>
        {tokenStr} tokens ({pct}%) · {shortCwd(cwd)} · {model}
        {cost != null ? ` · $${cost.toFixed(4)}` : ''}
      </Text>
    </Box>
  );
}
