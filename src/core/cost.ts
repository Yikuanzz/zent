/**
 * Cost helper. Computes USD cost from accumulated token usage and optional
 * pricing. When pricing is absent, returns null (UI shows token counts only).
 */
import type { Pricing, TokenUsage } from './types.ts';

export function computeCost(usage: TokenUsage, pricing?: Pricing): number | null {
  if (!pricing) return null;
  return (usage.prompt / 1_000_000) * pricing.input + (usage.completion / 1_000_000) * pricing.output;
}
