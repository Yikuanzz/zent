#!/usr/bin/env bun
/**
 * CLI entry. Parses arguments and delegates to the bootstrap in src/index.
 *
 * Usage:
 *   bun run bin/cli.tsx [--model <m>] [--config <path>] [--cwd <dir>]
 */
import { start } from '../src/index.tsx';
import type { CliOverrides } from '../src/config.ts';

function parseArgs(argv: string[]): CliOverrides {
  const out: CliOverrides = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--model') out.model = next();
    else if (a === '--config') out.configPath = next();
    else if (a === '--cwd') out.cwd = next();
    else if (a === '--base-url') out.baseUrl = next();
    else if (a === '--help' || a === '-h') {
      console.log('用法: zent [--model <m>] [--config <path>] [--cwd <dir>] [--base-url <url>]');
      process.exit(0);
    }
  }
  return out;
}

start(parseArgs(process.argv.slice(2)));
