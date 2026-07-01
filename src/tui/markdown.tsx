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

// ── Table support ───────────────────────────────────────────────────────────

type TableAlign = 'left' | 'center' | 'right';

export interface ParsedTable {
  headers: string[];
  aligns: TableAlign[];
  rows: string[][];
}

type BlockSegment =
  | { type: 'paragraph'; lines: string[] }
  | { type: 'table'; table: ParsedTable };

function splitCells(line: string): string[] {
  const trimmed = line.trim();
  const hasOuterPipes = trimmed.startsWith('|') && trimmed.endsWith('|');
  const parts = trimmed.split('|');
  if (hasOuterPipes) {
    return parts.slice(1, -1).map((c) => c.trim());
  }
  return parts.map((c) => c.trim()).filter((c, i, arr) => i > 0 || c !== '');
}

function isTableLine(line: string): boolean {
  return line.includes('|');
}

function isSeparatorRow(line: string): boolean {
  if (!isTableLine(line)) return false;
  const cells = splitCells(line);
  return cells.length > 0 && cells.every((c) => /^[\s:-]+$/.test(c) && /-+/.test(c));
}

function parseAlign(cell: string): TableAlign {
  const c = cell.trim();
  const left = c.startsWith(':');
  const right = c.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return 'left';
}

function parseTableAt(lines: string[], startIdx: number): { table: ParsedTable; endIdx: number } | null {
  if (startIdx + 1 >= lines.length) return null;
  const headerLine = lines[startIdx];
  const separatorLine = lines[startIdx + 1];
  if (!headerLine || !separatorLine) return null;
  if (!isTableLine(headerLine) || !isSeparatorRow(separatorLine)) return null;

  const headers = splitCells(headerLine);
  const colCount = headers.length;
  if (colCount === 0) return null;

  const aligns = splitCells(separatorLine).map(parseAlign).slice(0, colCount);
  while (aligns.length < colCount) aligns.push('left');

  const rows: string[][] = [];
  let endIdx = startIdx + 2;
  for (let i = startIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !isTableLine(line)) break;
    const cells = splitCells(line);
    while (cells.length < colCount) cells.push('');
    rows.push(cells.slice(0, colCount));
    endIdx = i + 1;
  }

  return { table: { headers, aligns, rows }, endIdx };
}

export function splitIntoBlocks(text: string, streaming: boolean): BlockSegment[] {
  const lines = text.split('\n');
  const segments: BlockSegment[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!streaming) {
      const tableResult = parseTableAt(lines, i);
      if (tableResult) {
        segments.push({ type: 'table', table: tableResult.table });
        i = tableResult.endIdx;
        continue;
      }
    }

    const paraLines: string[] = [lines[i]!];
    i++;
    while (i < lines.length) {
      if (!streaming && parseTableAt(lines, i)) break;
      paraLines.push(lines[i]!);
      i++;
    }
    segments.push({ type: 'paragraph', lines: paraLines });
  }

  return segments;
}

function padCell(text: string, width: number, align: TableAlign): string {
  const len = text.length;
  if (len >= width) return text;
  const diff = width - len;
  if (align === 'right') return ' '.repeat(diff) + text;
  if (align === 'center') {
    const left = Math.floor(diff / 2);
    const right = diff - left;
    return ' '.repeat(left) + text + ' '.repeat(right);
  }
  return text + ' '.repeat(diff);
}

function computeColumnWidths(table: ParsedTable): number[] {
  const widths = table.headers.map((h) => h.length);
  for (const row of table.rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return widths;
}

function TableBlock({ table, color }: { table: ParsedTable; color: string }) {
  const widths = computeColumnWidths(table);
  const lastCol = widths.length - 1;

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Header */}
      <Box flexDirection="row">
        {table.headers.map((h, i) => (
          <Text key={`h-${i}`} bold>
            {padCell(h, widths[i] ?? 0, table.aligns[i] ?? 'left')}
            {i < lastCol ? '  ' : ''}
          </Text>
        ))}
      </Box>
      {/* Separator */}
      <Box flexDirection="row">
        {widths.map((w, i) => (
          <Text key={`s-${i}`} dimColor>
            {'-'.repeat(w)}
            {i < lastCol ? '  ' : ''}
          </Text>
        ))}
      </Box>
      {/* Rows */}
      {table.rows.map((row, ri) => (
        <Box key={`r-${ri}`} flexDirection="row">
          {row.map((cell, ci) => (
            <Text key={`c-${ci}`} color={color}>
              {padCell(cell, widths[ci] ?? 0, table.aligns[ci] ?? 'left')}
              {ci < lastCol ? '  ' : ''}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  );
}


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

function PlainBlock({ content, color, streaming }: { content: string; color: string; streaming: boolean }) {
  const segments = splitIntoBlocks(content, streaming);

  return (
    <Box flexDirection="column">
      {segments.map((seg, si) => {
        if (seg.type === 'table') {
          return <TableBlock key={`t-${si}`} table={seg.table} color={color} />;
        }

        return seg.lines.map((line, li) => {
          const key = `${si}-${li}`;
          const heading = line.match(HEADING_RE);
          if (heading) {
            const level = heading[1]!.length;
            const text = heading[2]!;
            return (
              <Box key={key} marginTop={level <= 2 ? 1 : 0}>
                <Text bold color="#d79921">{text}</Text>
              </Box>
            );
          }
          const ul = line.match(UL_RE);
          if (ul) {
            const indent = ul[1]!.length;
            const text = ul[2]!;
            return (
              <Box key={key} paddingLeft={Math.floor(indent / 2) + 1}>
                <Text dimColor>•{' '}</Text>
                <Text>{renderInline(text, key, color)}</Text>
              </Box>
            );
          }
          const ol = line.match(OL_RE);
          if (ol) {
            const indent = ol[1]!.length;
            const num = ol[2]!;
            const text = ol[3]!;
            return (
              <Box key={key} paddingLeft={Math.floor(indent / 2) + 1}>
                <Text dimColor>{num}.{' '}</Text>
                <Text>{renderInline(text, key, color)}</Text>
              </Box>
            );
          }
          return <Text key={key}>{renderInline(line, key, color)}</Text>;
        });
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
          return <PlainBlock key={`p-${i}`} content={seg.content} color={color} streaming={streaming} />;
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
