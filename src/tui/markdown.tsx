/**
 * Minimal Markdown renderer for the conversation view. Supports the constructs
 * that matter for a coding agent: fenced code blocks (syntax-highlighted via
 * cli-highlight), inline `code`, and **bold**. Everything else renders as text.
 *
 * cli-highlight emits ANSI escape codes which Ink's <Text> passes through.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { highlight } from 'cli-highlight';

const FENCE_RE = /```(\w*)\n?([\s\S]*?)```/g;
const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*)/g;

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const parts = text.split(INLINE_RE).filter((s) => s !== '');
  return parts.map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <Text key={key} backgroundColor="#222" color="#d7d7d7">
          {' '}
          {part.slice(1, -1)}{' '}
        </Text>
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <Text key={key} bold>
          {part.slice(2, -2)}
        </Text>
      );
    }
    return <Text key={key}>{part}</Text>;
  });
}

function highlightCode(code: string, lang: string): string {
  try {
    return highlight(code.replace(/\n$/, ''), { language: lang || undefined, ignoreIllegals: true });
  } catch {
    return code.replace(/\n$/, '');
  }
}

/** Render markdown text as Ink nodes. `tone` sets the base text color. */
export function Markdown({ text, color = '#e0e0e0' }: { text: string; color?: string }) {
  const blocks: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  FENCE_RE.lastIndex = 0;
  while ((match = FENCE_RE.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before.trim()) {
      blocks.push(
        <Text key={`t-${idx}`} color={color}>
          {renderInline(before.replace(/\n+$/, ''), `t-${idx}`)}
        </Text>,
      );
    }
    const lang = match[1] ?? '';
    const code = match[2] ?? '';
    blocks.push(
      <Box key={`c-${idx}`} flexDirection="column" borderStyle="round" borderColor="#444" paddingX={1}>
        {highlightCode(code, lang)
          .split('\n')
          .map((line, li) => (
            <Text key={li}>{line}</Text>
          ))}
      </Box>,
    );
    lastIndex = FENCE_RE.lastIndex;
    idx++;
  }

  const tail = text.slice(lastIndex);
  if (tail.trim()) {
    blocks.push(
      <Text key={`t-${idx}`} color={color}>
        {renderInline(tail.replace(/\n+$/, ''), `t-${idx}`)}
      </Text>,
    );
  }

  return <Box flexDirection="column">{blocks}</Box>;
}
