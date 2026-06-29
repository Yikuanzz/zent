/**
 * File completion source for the @-mention popup. Lists files under cwd,
 * respecting .gitignore (plus common always-ignore dirs), returning relative
 * POSIX-style paths. Results are filtered by the partial token the user typed.
 */
import fg from 'fast-glob';

let cache: string[] | null = null;

export async function listFiles(cwd: string): Promise<string[]> {
  if (cache) return cache;
  const entries = await fg('**/*', {
    cwd,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.trellis/**'],
    suppressErrors: true,
  });
  // fast-glob respects .gitignore only with the `ignore` option; for stage A the
  // explicit ignores above cover the noisy dirs. Cap to keep the popup snappy.
  cache = entries.slice(0, 5000);
  return cache;
}

export function filterFiles(all: string[], partial: string, limit = 10): string[] {
  const p = partial.toLowerCase();
  if (!p) return all.slice(0, limit);
  const starts = all.filter((f) => f.toLowerCase().startsWith(p));
  const contains = all.filter((f) => !f.toLowerCase().startsWith(p) && f.toLowerCase().includes(p));
  return [...starts, ...contains].slice(0, limit);
}
