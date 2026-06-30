/**
 * Streaming-aware Markdown renderer. Matches Claude Code's behavior:
 *
 *   - While streaming (`streaming=true`): render inline formatting (`code`,
 *     **bold**) as soon as the markers close; keep fenced code blocks as plain
 *     text until the closing fence arrives, then highlight them.
 *   - When complete (`streaming=false`): full render, including syntax
 *     highlighting for closed fenced code blocks.
 *
 * This avoids the jarring "half-formed code block" effect while still giving
 * live inline styling.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { highlight } from 'cli-highlight';

const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*)/g;

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
    out.push({ type: streaming ? 'plain' : 'plain', lang: '', content: rest });
  }

  return out;
}

export function Markdown({ text, color = '#e0e0e0', streaming = false }: MarkdownProps) {
  const segments = segment(text, streaming);

  return (
    <Box flexDirection="column">
      {segments.map((seg, i) => {
        if (seg.type === 'plain') {
          return (
            <Box key={`p-${i}`} flexDirection="column">
              {seg.content.split('\n').map((line, li) => (
                <Text key={li}>{renderInline(line, `${i}-${li}`, color)}</Text>
              ))}
            </Box>
          );
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
      })}
    </Box>
  );
}
