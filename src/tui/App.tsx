/**
 * App: single-column layout (Claude Code style) + focus state machine.
 *
 *   [ conversation flow .................................. ]
 *   [ spinner | approval | review | input               ]
 *   [ hint line (dim shortcuts)                          ]
 *   [ status bar (tokens · cwd · model)                  ]
 *
 * Focus modes:
 *   input    — typing (InputBox active). Esc → review. Ctrl+O → expand latest.
 *   running  — agent working (spinner). Esc → abort.
 *   approval — dangerous tool awaiting y/n.
 *   review   — ↑/↓ select tool items; Enter toggles; Esc → input.
 */
import React, { useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { ConversationView } from './ConversationView.tsx';
import { StatusBar } from './StatusBar.tsx';
import { Spinner } from './Spinner.tsx';
import { InputBox } from './InputBox.tsx';
import { useAgent } from './useAgent.ts';
import { injectMentions } from './injectMentions.ts';
import type { FocusMode } from './types.ts';
import type { Config, LLMClient, Tool } from '../core/types.ts';
import type { SessionLogger } from '../core/logger.ts';

interface Props {
  config: Config;
  client: LLMClient;
  tools: Record<string, Tool>;
  systemPrompt: string;
  logger?: SessionLogger;
}

const ACCENT = '#d79921';

export function App({ config, client, tools, systemPrompt, logger }: Props) {
  const { exit } = useApp();
  const agent = useAgent({ config, client, tools, systemPrompt, logger });
  const [reviewSel, setReviewSel] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const mode: FocusMode = agent.pendingApproval
    ? 'approval'
    : agent.isRunning
      ? 'running'
      : reviewing
        ? 'review'
        : 'input';

  const toolIds = useMemo(
    () => agent.items.filter((i) => i.kind === 'tool').map((i) => i.id),
    [agent.items],
  );

  useInput((input, key) => {
    if (mode === 'approval') {
      if (input?.toLowerCase() === 'y') agent.respondApproval(true);
      else if (input?.toLowerCase() === 'n' || key.escape) agent.respondApproval(false);
      return;
    }

    if (mode === 'running') {
      if (key.escape) agent.abort();
      return;
    }

    if (key.ctrl && input === 'o') {
      agent.expandLatestTool();
      return;
    }

    if (mode === 'input') {
      if (key.escape && toolIds.length) {
        setReviewing(true);
        setReviewSel(toolIds[toolIds.length - 1] ?? null);
      }
      if (key.ctrl && input === 'c') exit();
      return;
    }

    if (mode === 'review') {
      if (key.escape) {
        setReviewing(false);
        setReviewSel(null);
        return;
      }
      const idx = reviewSel != null ? toolIds.indexOf(reviewSel) : -1;
      if (key.upArrow) setReviewSel(toolIds[Math.max(0, idx - 1)] ?? reviewSel);
      if (key.downArrow) setReviewSel(toolIds[Math.min(toolIds.length - 1, idx + 1)] ?? reviewSel);
      if (key.return && reviewSel != null) agent.toggleCollapse(reviewSel);
    }
  });

  const handleSubmit = async (text: string) => {
    const modelText = await injectMentions(text, config.cwd, config.maxToolOutputChars);
    agent.submit(text, modelText);
  };

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text color={ACCENT}>● </Text>
        <Text dimColor>zent</Text>
      </Box>

      <ConversationView items={agent.items} selectedId={reviewSel} reviewMode={mode === 'review'} />

      <Box marginTop={1} flexDirection="column">
        {mode === 'approval' && agent.pendingApproval ? (
          <Box paddingX={1}>
            <Text color={ACCENT}>
              ⏵ {agent.pendingApproval.name}({JSON.stringify(agent.pendingApproval.args)}) — run? [y/N]
            </Text>
          </Box>
        ) : mode === 'running' ? (
          <Spinner usage={agent.usage} startedAt={agent.runStartedAt} />
        ) : mode === 'review' ? (
          <>
            <Box paddingX={1}>
              <Text dimColor>review · ↑/↓ select · enter toggle · esc back</Text>
            </Box>
            <StatusBar usage={agent.usage} contextWindow={config.contextWindow} cwd={config.cwd} model={config.model} cost={agent.cost} />
          </>
        ) : (
          <>
            <InputBox active={mode === 'input'} cwd={config.cwd} onSubmit={handleSubmit} />
            <StatusBar usage={agent.usage} contextWindow={config.contextWindow} cwd={config.cwd} model={config.model} cost={agent.cost} />
          </>
        )}
      </Box>
    </Box>
  );
}
