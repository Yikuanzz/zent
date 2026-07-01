/**
 * Configuration loading. Reads a single JSON file from the user's home dir
 * (~/.zent/config.json by default) and merges CLI overrides on top.
 *
 * Secrets (apiKey) live in this file, so it must never be committed.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { ApprovalMode, Config, Pricing } from './core/types.ts';

// Default config directory and path
export const DEFAULT_CONFIG_DIR = join(homedir(), '.zent');
export const DEFAULT_CONFIG_PATH = join(DEFAULT_CONFIG_DIR, 'config.json');
export const SESSIONS_DIR = join(DEFAULT_CONFIG_DIR, 'sessions');

// Default config values
const DEFAULTS = {
  maxIterations: 25,
  maxToolOutputChars: 4000,
  keepRecentTurns: 20,
  contextWindow: 128000,
} as const;

// Command line overrides
export interface CliOverrides {
  configPath?: string; // Path to config file
  model?: string; // Model name
  cwd?: string; // Working directory
  baseUrl?: string; // Base URL for the API
  apiKey?: string; // API key
  approvalMode?: string; // 'manual' | 'suggest' | 'full-auto'
}

interface RawConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  maxIterations?: number;
  maxToolOutputChars?: number;
  keepRecentTurns?: number;
  pricing?: Pricing;
  contextWindow?: number;
  cwd?: string;
  approvalMode?: string;
  shellSafety?: string;
  shellBlacklist?: string[];
  shellWhitelist?: string[];
  allowShellRedirectOutsideCwd?: boolean;
  enableSummarization?: boolean;
  summarizeThreshold?: number;
  summarizeMinMessages?: number;
}

const VALID_APPROVAL_MODES: ApprovalMode[] = ['manual', 'suggest', 'full-auto'];

function parseApprovalMode(raw: string | undefined, source: string): ApprovalMode {
  const value = raw?.trim();
  if (!value) return 'manual';
  if (VALID_APPROVAL_MODES.includes(value as ApprovalMode)) return value as ApprovalMode;
  console.warn(`[zent] 非法 approvalMode (${source}): "${value}"，回退为 manual`);
  return 'manual';
}

function parseShellSafety(raw: string | undefined): 'strict' | 'permissive' {
  const value = raw?.trim();
  if (value === 'permissive') return 'permissive';
  return 'strict';
}

function parseBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  return fallback;
}

function parseNumberInRange(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw === 'number' && !isNaN(raw)) {
    const v = Math.max(min, Math.min(max, raw));
    return v;
  }
  return fallback;
}

function parseStringArray(raw: unknown): string[] {
  if (Array.isArray(raw) && raw.every((x) => typeof x === 'string')) return raw as string[];
  return [];
}

export class ConfigError extends Error {}

function readRawConfig(path: string): RawConfig {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RawConfig;
  } catch (e) {
    throw new ConfigError(`配置文件解析失败 (${path}): ${(e as Error).message}`);
  }
}

/**
 * Load and validate config. CLI overrides take precedence over the file.
 * Throws ConfigError with actionable guidance when required fields are missing.
 */
export function loadConfig(overrides: CliOverrides = {}): Config {
  const path = overrides.configPath ?? DEFAULT_CONFIG_PATH;
  const raw = readRawConfig(path);

  const baseUrl = overrides.baseUrl ?? raw.baseUrl ?? process.env.OPENAI_BASE_URL;
  const apiKey = overrides.apiKey ?? raw.apiKey ?? process.env.OPENAI_API_KEY;
  const model = overrides.model ?? raw.model ?? process.env.MODEL;

  const approvalMode = parseApprovalMode(
    overrides.approvalMode ?? raw.approvalMode,
    overrides.approvalMode ? 'CLI' : 'config',
  );

  const shellSafety = parseShellSafety(raw.shellSafety);
  const shellBlacklist = parseStringArray(raw.shellBlacklist);
  const shellWhitelist = parseStringArray(raw.shellWhitelist);
  const allowShellRedirectOutsideCwd = raw.allowShellRedirectOutsideCwd === true;

  const enableSummarization = parseBool(raw.enableSummarization, true);
  const summarizeThreshold = parseNumberInRange(raw.summarizeThreshold, 0.7, 0, 1);
  const summarizeMinMessages = Math.max(2, Math.round(raw.summarizeMinMessages ?? 6));

  const missing: string[] = [];
  if (!baseUrl) missing.push('baseUrl');
  if (!apiKey) missing.push('apiKey');
  if (!model) missing.push('model');

  if (missing.length > 0) {
    throw new ConfigError(
      `缺少必需配置: ${missing.join(', ')}\n` +
        `请创建配置文件 ${path}，内容示例:\n` +
        `{\n` +
        `  "baseUrl": "https://your-endpoint/v1",\n` +
        `  "apiKey": "sk-...",\n` +
        `  "model": "kimi-for-coding"\n` +
        `}\n` +
        `（也可通过环境变量 OPENAI_BASE_URL / OPENAI_API_KEY / MODEL 或 CLI 参数提供）`,
    );
  }

  return {
    baseUrl: baseUrl!,
    apiKey: apiKey!,
    model: model!,
    maxIterations: raw.maxIterations ?? DEFAULTS.maxIterations,
    maxToolOutputChars: raw.maxToolOutputChars ?? DEFAULTS.maxToolOutputChars,
    keepRecentTurns: raw.keepRecentTurns ?? DEFAULTS.keepRecentTurns,
    pricing: raw.pricing,
    contextWindow: raw.contextWindow ?? DEFAULTS.contextWindow,
    cwd: overrides.cwd ?? raw.cwd ?? process.cwd(),
    approvalMode,
    shellSafety,
    shellBlacklist,
    shellWhitelist,
    allowShellRedirectOutsideCwd,
    enableSummarization,
    summarizeThreshold,
    summarizeMinMessages,
  };
}
