/**
 * Shell command safety checker. Inspects a command string before execution and
 * blocks obviously dangerous patterns (destructive commands, remote pipe-sh,
 * redirections outside the working directory, etc.).
 *
 * Defaults are intentionally conservative: false positives are preferred over
 * false negatives. Users can tune behavior via config whitelist/blacklist.
 */
import { isAbsolute, relative, resolve } from 'node:path';
import type { ToolContext } from '../types.ts';

export interface ShellSafetyResult {
  safe: boolean;
  reason?: string;
}

interface ShellSafetyConfig {
  cwd: string;
  shellSafety: 'strict' | 'permissive';
  shellBlacklist: string[];
  shellWhitelist: string[];
  allowShellRedirectOutsideCwd: boolean;
}

// Strict mode: full default blacklist.
const DEFAULT_BLACKLIST_STRICT = [
  // rm -rf /, rm -rf /*, rm -rf ~
  /rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+['"]?\/(\.\*)?/,
  /rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+['"]?~/,
  // disk / filesystem operations
  /\b(dd|mkfs|fdisk|parted|format)\b/,
  // recursive system-wide chmod/chown
  /chmod\s+-R\s+['"]?\//,
  /chown\s+-R\s+['"]?\//,
  // remote code execution via pipe
  /curl\s+[^|]+\|\s*(ba)?sh/,
  /wget\s+[^|]+\|\s*(ba)?sh/,
  // common destructive one-liners
  /:\(\)\s*\{\s*:\|\s*:\s*&\s*\}\s*;\s*:\s*\/\/\s*fork bomb/,
];

// Permissive mode: only the most catastrophic patterns.
const DEFAULT_BLACKLIST_PERMISSIVE = [
  /rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+['"]?\/(\.\*)?/,
  /rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+['"]?~/,
  /\b(dd|mkfs|fdisk|parted)\b/,
];

function makeRegexList(patterns: string[]): RegExp[] {
  return patterns
    .map((p) => {
      try {
        return new RegExp(p);
      } catch {
        console.warn(`[zent] 非法黑名单正则，已跳过: ${p}`);
        return null;
      }
    })
    .filter((r): r is RegExp => r !== null);
}

function matchesAny(command: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(command));
}

/**
 * Extract redirect targets from a command. Handles >, >>, 1>, 2>, 2>>, etc.
 * Returns a list of raw target strings (quotes stripped).
 */
function extractRedirectTargets(command: string): string[] {
  const targets: string[] = [];
  const re = /[12]?>>?\s*(['"]?)([^\s;|&<>]+)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    targets.push(m[2]!);
  }
  return targets;
}

function isInsideCwd(target: string, cwd: string): boolean {
  const abs = isAbsolute(target) ? resolve(target) : resolve(cwd, target);
  const rel = relative(cwd, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return false;
  return true;
}

export function checkShellSafety(command: string, ctx: ToolContext): ShellSafetyResult {
  const cfg: ShellSafetyConfig = {
    cwd: ctx.cwd,
    shellSafety: ctx.config.shellSafety ?? 'strict',
    shellBlacklist: ctx.config.shellBlacklist ?? [],
    shellWhitelist: ctx.config.shellWhitelist ?? [],
    allowShellRedirectOutsideCwd: ctx.config.allowShellRedirectOutsideCwd ?? false,
  };

  const whitelist = makeRegexList(cfg.shellWhitelist);
  if (matchesAny(command, whitelist)) {
    return { safe: true };
  }

  const defaultBlacklist =
    cfg.shellSafety === 'permissive' ? DEFAULT_BLACKLIST_PERMISSIVE : DEFAULT_BLACKLIST_STRICT;
  const customBlacklist = makeRegexList(cfg.shellBlacklist);
  const blacklist = [...defaultBlacklist, ...customBlacklist];

  if (matchesAny(command, blacklist)) {
    return {
      safe: false,
      reason: `命令被安全策略拦截：疑似危险操作。可调整 shellSafety / shellBlacklist / shellWhitelist 配置。`,
    };
  }

  if (!cfg.allowShellRedirectOutsideCwd) {
    const targets = extractRedirectTargets(command);
    for (const target of targets) {
      if (!isInsideCwd(target, cfg.cwd)) {
        return {
          safe: false,
          reason: `重定向目标越界：${target} 不在工作目录内。如需允许，设置 allowShellRedirectOutsideCwd: true。`,
        };
      }
    }
  }

  return { safe: true };
}
