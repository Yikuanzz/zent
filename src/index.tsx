/**
 * Bootstrap: load config, wire core dependencies, render the Ink app.
 * Called by bin/cli.tsx after CLI args are parsed.
 */
import React from 'react';
import { render } from 'ink';
import { App } from './tui/App.tsx';
import { loadConfig, ConfigError, SESSIONS_DIR, type CliOverrides } from './config.ts';
import { createLLMClient } from './core/providers/index.ts';
import { registry } from './core/tools/index.ts';
import { buildSystemPrompt } from './core/prompt.ts';
import { createSessionLogger } from './core/logger.ts';

export function start(overrides: CliOverrides): void {
  let config;
  try {
    config = loadConfig(overrides);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error('\x1b[31m' + e.message + '\x1b[0m');
      process.exit(1);
    }
    throw e;
  }

  const client = createLLMClient(config);
  const systemPrompt = buildSystemPrompt(config.cwd);

  // Timestamp generated here (entry layer) so core never reads the clock.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logger = createSessionLogger(SESSIONS_DIR, stamp);

  const { waitUntilExit } = render(
    <App config={config} client={client} tools={registry} systemPrompt={systemPrompt} logger={logger} />,
  );
  void waitUntilExit();
}
