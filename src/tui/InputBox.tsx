/**
 * InputBox: multi-line input with @-file completion.
 *
 *   - Enter submits; a line ending with "\" inserts a newline (reliable
 *     multi-line across terminals). Shift+Enter also inserts a newline where
 *     the terminal reports it.
 *   - Typing "@" begins a completion token; a popup lists matching files.
 *     ↑/↓ navigate, Tab/Enter accept, Esc cancels the popup.
 *
 * Active only in 'input' focus mode (gated via useInput isActive).
 */
import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { listFiles, filterFiles } from './fileComplete.ts';

interface Props {
  active: boolean;
  cwd: string;
  onSubmit: (text: string) => void;
}

/** Extract the @-token immediately before the cursor (end of buffer). */
function currentMention(buffer: string): { token: string; start: number } | null {
  const m = buffer.match(/(^|\s)@([^\s@]*)$/);
  if (!m) return null;
  const token = m[2] ?? '';
  const start = buffer.length - token.length - 1; // position of '@'
  return { token, start };
}

export function InputBox({ active, cwd, onSubmit }: Props) {
  const [buffer, setBuffer] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [completion, setCompletion] = useState<{ candidates: string[]; index: number } | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null); // null = editing fresh line

  useEffect(() => {
    if (active) void listFiles(cwd).then(setFiles);
  }, [active, cwd]);

  // Recompute completion candidates whenever the buffer changes.
  useEffect(() => {
    const mention = currentMention(buffer);
    if (mention) {
      const candidates = filterFiles(files, mention.token);
      setCompletion(candidates.length ? { candidates, index: 0 } : null);
    } else {
      setCompletion(null);
    }
  }, [buffer, files]);

  const acceptCompletion = () => {
    if (!completion) return;
    const mention = currentMention(buffer);
    if (!mention) return;
    const chosen = completion.candidates[completion.index]!;
    const before = buffer.slice(0, mention.start);
    setBuffer(`${before}@${chosen} `);
    setCompletion(null);
  };

  useInput(
    (input, key) => {
      // Completion popup navigation takes precedence.
      if (completion) {
        if (key.upArrow) {
          setCompletion({ ...completion, index: (completion.index - 1 + completion.candidates.length) % completion.candidates.length });
          return;
        }
        if (key.downArrow) {
          setCompletion({ ...completion, index: (completion.index + 1) % completion.candidates.length });
          return;
        }
        if (key.tab) {
          acceptCompletion();
          return;
        }
        if (key.escape) {
          setCompletion(null);
          return;
        }
      }

      // Command history (↑/↓) when no completion popup is open.
      if (!completion && (key.upArrow || key.downArrow)) {
        if (history.length === 0) return;
        if (key.upArrow) {
          const idx = histIdx == null ? history.length - 1 : Math.max(0, histIdx - 1);
          setHistIdx(idx);
          setBuffer(history[idx] ?? '');
        } else {
          if (histIdx == null) return;
          const idx = histIdx + 1;
          if (idx >= history.length) {
            setHistIdx(null);
            setBuffer('');
          } else {
            setHistIdx(idx);
            setBuffer(history[idx] ?? '');
          }
        }
        return;
      }

      if (key.return) {
        // Shift+Enter or trailing backslash → newline.
        if (key.shift || buffer.endsWith('\\')) {
          setBuffer((b) => (b.endsWith('\\') ? b.slice(0, -1) + '\n' : b + '\n'));
          return;
        }
        if (completion) {
          acceptCompletion();
          return;
        }
        const text = buffer.trim();
        setBuffer('');
        setCompletion(null);
        setHistIdx(null);
        if (text) {
          setHistory((h) => (h[h.length - 1] === text ? h : [...h, text]));
          onSubmit(text);
        }
        return;
      }

      if (key.backspace || key.delete) {
        setBuffer((b) => b.slice(0, -1));
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        setHistIdx(null);
        setBuffer((b) => b + input);
      }
    },
    { isActive: active },
  );

  return (
    <Box flexDirection="column">
      {completion && (
        <Box flexDirection="column" paddingX={1}>
          {completion.candidates.map((c, i) => (
            <Text key={c} color={i === completion.index ? '#d79921' : undefined} dimColor={i !== completion.index}>
              {i === completion.index ? '❯ ' : '  '}
              {c}
            </Text>
          ))}
        </Box>
      )}
      <Box
        borderStyle="single"
        borderColor="#3a3a3a"
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingX={1}
      >
        <Text color="#d79921">{'❯ '}</Text>
        <Text>
          {buffer.length ? buffer : <Text dimColor>Ask anything…</Text>}
          {active && <Text inverse> </Text>}
        </Text>
      </Box>
      <Box paddingX={1}>
        <Text dimColor>⏎ send · \ newline · @ files · ↑↓ history · esc stop</Text>
      </Box>
    </Box>
  );
}
