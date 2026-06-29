/**
 * JSONL session logger. Appends each event/message as one JSON line for later
 * replay/analysis. No resume in stage A — write-only.
 *
 * The timestamp used in the filename is injected by the caller (so core code
 * never needs to read the clock directly).
 */
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentEvent } from './types.ts';

export interface SessionLogger {
  logEvent(e: AgentEvent): void;
  logUser(task: string): void;
  path: string;
}

export function createSessionLogger(sessionsDir: string, stamp: string): SessionLogger {
  mkdirSync(sessionsDir, { recursive: true });
  const path = join(sessionsDir, `${stamp}.jsonl`);
  const write = (obj: unknown) => {
    try {
      appendFileSync(path, JSON.stringify(obj) + '\n', 'utf8');
    } catch {
      /* logging must never crash the agent */
    }
  };
  return {
    path,
    logEvent: (e) => write({ kind: 'event', ...e }),
    logUser: (task) => write({ kind: 'user', task }),
  };
}
