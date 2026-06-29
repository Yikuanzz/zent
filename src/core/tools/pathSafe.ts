/**
 * Path safety: confine all file/shell paths to the working directory subtree.
 * Rejects traversal outside cwd (e.g. ../../etc/passwd).
 */
import { isAbsolute, resolve, relative } from 'node:path';

export class PathSafetyError extends Error {}

/**
 * Resolve `p` against `cwd` and verify the result stays inside the cwd subtree.
 * Returns the absolute resolved path, or throws PathSafetyError.
 */
export function resolveInCwd(p: string, cwd: string): string {
  const abs = isAbsolute(p) ? resolve(p) : resolve(cwd, p);
  const rel = relative(cwd, abs);
  if (rel === '' ) return abs; // the cwd itself
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new PathSafetyError(`路径越界，禁止访问工作目录之外: ${p}`);
  }
  return abs;
}
