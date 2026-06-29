/**
 * ConversationView: single-column vertical flow, Claude Code style.
 *
 *   user        → "❯ text" (accent prefix)
 *   thinking    → plain dim narration (calm, recedes)
 *   plan        → inline checklist ([x]/[>]/[ ]/[-])
 *   tool        → tree form:  ⏺ name(args)
 *                              ⎿ summary (duration)   [expandable]
 *   finish      → markdown-rendered answer (light foreground)
 *   error       → red ⏺ line
 *
 * No boxes, no side panel. Indentation + a single accent carry the hierarchy.
 */
import React from 'react';
import { Box, Text } from 'ink';
import type { DisplayItem } from './types.ts';
import { Markdown } from './markdown.tsx';

const ACCENT = '#d79921'; // muted amber, used sparingly
const DOT_COLOR: Record<string, string> = {
  running: ACCENT,
  ok: '#98971a',
  failed: '#cc241d',
  denied: '#cc241d',
};
const PLAN_MARK: Record<string, { mark: string; color?: string; dim?: boolean }> = {
  pending: { mark: '[ ]', dim: true },
  running: { mark: '[>]', color: ACCENT },
  done: { mark: '[x]', color: '#98971a' },
  failed: { mark: '[-]', color: '#cc241d' },
};

function fmtDuration(ms: number): string {
  if (ms <= 0) return '';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function argsPreview(args: Record<string, unknown>): string {
  const salient = (args.command ?? args.path ?? args.summary) as string | undefined;
  const s = typeof salient === 'string' ? salient : JSON.stringify(args);
  return s.length > 64 ? s.slice(0, 61) + '…' : s;
}

function ToolItem({ item, selected }: { item: Extract<DisplayItem, { kind: 'tool' }>; selected: boolean }) {
  const dot = DOT_COLOR[item.status] ?? '#7c6f64';
  const dur = fmtDuration(item.durationMs);
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={dot}>⏺</Text> <Text color="#d5c4a1">{item.name}</Text>
        <Text dimColor>({argsPreview(item.args)})</Text>
        {selected ? <Text color={ACCENT}>{'  ◂'}</Text> : null}
      </Text>
      <Text>
        {'  '}
        <Text dimColor>⎿ {item.status === 'running' ? 'running…' : item.summary}</Text>
        {dur ? <Text dimColor> ({dur})</Text> : null}
        {item.collapsed && item.status !== 'running' && item.full ? <Text dimColor> · o</Text> : null}
      </Text>
      {!item.collapsed &&
        item.full
          .split('\n')
          .slice(0, 80)
          .map((line, i) => (
            <Text key={i} dimColor>
              {'    '}
              {line}
            </Text>
          ))}
    </Box>
  );
}

export function ConversationView({
  items,
  selectedId,
  reviewMode,
}: {
  items: DisplayItem[];
  selectedId: number | null;
  reviewMode: boolean;
}) {
  return (
    <Box flexDirection="column" paddingX={1}>
      {items.map((item) => {
        switch (item.kind) {
          case 'user':
            return (
              <Box key={item.id} marginTop={1}>
                <Text color={ACCENT}>❯ </Text>
                <Text>{item.text}</Text>
              </Box>
            );
          case 'assistant':
            return (
              <Box key={item.id} marginTop={1} flexDirection="column">
                {item.done ? (
                  <Markdown text={item.text} color="#ebdbb2" />
                ) : (
                  <Text color="#ebdbb2">{item.text}</Text>
                )}
              </Box>
            );
          case 'plan':
            return (
              <Box key={item.id} flexDirection="column" marginTop={1}>
                {item.steps.map((s, i) => {
                  const m = PLAN_MARK[s.status] ?? PLAN_MARK.pending!;
                  return (
                    <Text key={i} color={m.color} dimColor={m.dim}>
                      {'  '}
                      {m.mark} {s.title}
                    </Text>
                  );
                })}
              </Box>
            );
          case 'tool':
            return <ToolItem key={item.id} item={item} selected={reviewMode && selectedId === item.id} />;
          case 'finish':
            return (
              <Box key={item.id} marginTop={1} flexDirection="column">
                <Markdown text={item.text} color="#ebdbb2" />
              </Box>
            );
          case 'error':
            return (
              <Box key={item.id} marginTop={1}>
                <Text color="#cc241d">⏺ {item.text}</Text>
              </Box>
            );
        }
      })}
    </Box>
  );
}
