/**
 * ConversationView: single-column vertical flow, Claude Code style, ASCII-clean.
 *
 *   user      → "> text"
 *   assistant → markdown answer (light foreground)
 *   plan      → inline checklist ([x]/[>]/[ ]/[-])
 *   tool      → "- name(args)" then indented "summary · 12ms  [+]"
 *               ([+] collapsed / [-] expanded; status carried by color)
 *   error     → "! text" (red)
 *
 * No boxes, no glyphs. Indentation + a single accent carry the hierarchy.
 */
import React from 'react';
import { Box, Text } from 'ink';
import type { DisplayItem } from './types.ts';
import { Markdown } from './markdown.tsx';

const ACCENT = '#d79921'; // muted amber, used sparingly
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
  const nameColor =
    item.status === 'failed'
      ? '#cc241d'
      : item.status === 'denied'
        ? '#7c6f64'
        : item.status === 'ok'
          ? '#d5c4a1'
          : ACCENT; // awaiting / running
  const dur = fmtDuration(item.durationMs);
  const canExpand = !!item.full && (item.status === 'ok' || item.status === 'failed');
  return (
    <Box flexDirection="column">
      <Text>
        {selected ? <Text color={ACCENT}>{'> '}</Text> : <Text dimColor>{'- '}</Text>}
        <Text color={nameColor}>{item.name}</Text>
        <Text dimColor>({argsPreview(item.args)})</Text>
      </Text>
      <Text>
        {'    '}
        <Text dimColor>{item.summary}</Text>
        {dur ? <Text dimColor> · {dur}</Text> : null}
        {canExpand ? <Text dimColor>{item.collapsed ? '  [+]' : '  [-]'}</Text> : null}
      </Text>
      {!item.collapsed &&
        item.full
          .split('\n')
          .slice(0, 80)
          .map((line, i) => (
            <Text key={i} dimColor>
              {'      '}
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
                <Text color={ACCENT}>{'> '}</Text>
                <Text>{item.text}</Text>
              </Box>
            );
          case 'assistant':
            return (
              <Box key={item.id} marginTop={1} flexDirection="column">
                <Markdown text={item.text} color="#ebdbb2" streaming={!item.done} />
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
                <Text color="#cc241d">! {item.text}</Text>
              </Box>
            );
        }
      })}
    </Box>
  );
}
