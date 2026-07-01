/**
 * Streaming-aware Markdown renderer. Matches Claude Code's behavior:
 *
 *   - While streaming (`streaming=true`): render inline formatting (`code`,
 *     **bold**) as soon as the markers close; keep fenced code blocks as plain
 *     text until the closing fence arrives, then highlight them.
 *   - When complete (`streaming=false`): full render, including syntax
 *     highlighting for closed fenced code blocks.
 *
 * Extended to also render common Markdown constructs that models emit:
 *   - headers (# / ## / ###)
 *   - unordered lists (- / * / +)
 *   - ordered lists (1. / 2.)
 *
 * This avoids the jarring "half-formed code block" effect while still giving
 * live inline styling.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { highlight } from 'cli-highlight';

const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*)/g;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UL_RE = /^(\s*)[-*+]\s+(.*)$/;
const OL_RE = /^(\s*)(\d+)\.\s+(.*)$/;

function renderInline(text: string, keyBase: string, color: string): React.ReactNode[] {
  const parts = text.split(INLINE_RE).filter((s) => s !== '');
  return parts.map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <Text key={key} backgroundColor="#222" color="#d7d7d7">
          {part.slice(1, -1)}
        </Text>
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <Text key={key} bold>{part.slice(2, -2)}</Text>;
    }
    return <Text key={key} color={color}>{part}</Text>;
  });
}

function highlightCode(code: string, lang: string): string {
  try {
    return highlight(code.replace(/\n$/, ''), { language: lang || undefined, ignoreIllegals: true });
  } catch {
    return code.replace(/\n$/, '');
  }
}

interface MarkdownProps {
  text: string;
  color?: string;
  streaming?: boolean;
}

function segment(text: string, streaming: boolean): { type: 'plain' | 'code'; lang: string; content: string }[] {
  const lines = text.split('\n');
  const out: { type: 'plain' | 'code'; lang: string; content: string }[] = [];
  let buffer: string[] = [];
  let inCode = false;
  let codeLang = '';
  let codeBuffer: string[] = [];

  const flushPlain = () => {
    if (buffer.length) {
      out.push({ type: 'plain', lang: '', content: buffer.join('\n') });
      buffer = [];
    }
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^(```+)\s*(\w*)/);
    if (fenceMatch) {
      if (!inCode) {
        flushPlain();
        inCode = true;
        codeLang = fenceMatch[2] ?? '';
        codeBuffer = [];
      } else {
        out.push({ type: 'code', lang: codeLang, content: codeBuffer.join('\n') });
        inCode = false;
        codeLang = '';
        codeBuffer = [];
      }
      continue;
    }
    if (inCode) {
      codeBuffer.push(line);
    } else {
      buffer.push(line);
    }
  }

  flushPlain();

  if (inCode) {
    const rest = '```' + (codeLang ? ` ${codeLang}` : '') + (codeBuffer.length ? '\n' + codeBuffer.join('\n') : '');
    out.push({ type: 'plain', lang: '', content: rest });
  }

  return out;
}

function PlainBlock({ content, color }: { content: string; color: string }) {
  return (
    <Box flexDirection="column">
      {content.split('\n').map((line, li) => {
        const heading = line.match(HEADING_RE);
        if (heading) {
          const level = heading[1]!.length;
          const text = heading[2]!;
          return (
            <Box key={li} marginTop={level <= 2 ? 1 : 0}>
              <Text bold color="#d79921">{text}</Text>
            </Box>
          );
        }
        const ul = line.match(UL_RE);
        if (ul) {
          const indent = ul[1]!.length;
          const text = ul[2]!;
          return (
            <Box key={li} paddingLeft={Math.floor(indent / 2) + 1}>
              <Text dimColor>•{' '}</Text>
              <Text>{renderInline(text, `${li}`, color)}</Text>
            </Box>
          );
        }
        const ol = line.match(OL_RE);
        if (ol) {
          const indent = ol[1]!.length;
          const num = ol[2]!;
          const text = ol[3]!;
          return (
            <Box key={li} paddingLeft={Math.floor(indent / 2) + 1}>
              <Text dimColor>{num}.{' '}</Text>
              <Text>{renderInline(text, `${li}`, color)}</Text>
            </Box>
          );
        }
        return <Text key={li}>{renderInline(line, `${li}`, color)}</Text>;
      })}
    </Box>
  );
}

export function Markdown({ text, color = '#e0e0e0', streaming = false }: MarkdownProps) {
  const segments = segment(text, streaming);

  return (
    <Box flexDirection="column">
      {segments.map((seg, i) => {
        if (seg.type === 'plain') {
          return <PlainBlock key={`p-${i}`} content={seg.content} color={color} />;
        }

        return (
          <Box key={`c-${i}`} flexDirection="column" borderStyle="round" borderColor="#444" paddingX={1}>
            {highlightCode(seg.content, seg.lang)
              .split('\n')
              .map((line, li) => (
                <Text key={li}>{line}</Text>
              ))}
          </Box>
        );
      })}</Box>
  );
}
