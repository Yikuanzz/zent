/**
 * Spinner: the "working" line shown while the agent runs.
 *   ⠋ Working…  (3s · 12.3k tokens)   esc to interrupt
 * A gentle braille-frame animation; ends implicitly when running stops.
 */
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { TokenUsage } from '../core/types.ts';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const ACCENT = '#d79921';

export function Spinner({ usage, startedAt }: { usage: TokenUsage | null; startedAt: number }) {
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length);
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 100);
    return () => clearInterval(t);
  }, [startedAt]);

  const tokens = usage?.total ?? 0;
  const tokenStr = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k tokens` : `${tokens} tokens`;

  return (
    <Box paddingX={1}>
      <Text color={ACCENT}>{FRAMES[frame]}</Text>
      <Text dimColor>
        {' '}
        Working…  ({elapsed}s · {tokenStr}){'   '}
      </Text>
      <Text dimColor>esc to interrupt</Text>
    </Box>
  );
}
