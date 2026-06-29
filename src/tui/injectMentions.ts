/**
 * @-mention content injection. Replaces @path tokens in the user's text with
 * the referenced file's content appended as context blocks (truncated). The
 * displayed text keeps the raw @path; only the model-facing text is augmented.
 */
import { readFile } from 'node:fs/promises';
import { resolveInCwd } from '../core/tools/pathSafe.ts';
import { truncateOutput } from '../core/context/truncation.ts';

const MENTION_RE = /(?:^|\s)@([^\s@]+)/g;

export async function injectMentions(text: string, cwd: string, maxChars: number): Promise<string> {
  const paths = new Set<string>();
  for (const m of text.matchAll(MENTION_RE)) {
    if (m[1]) paths.add(m[1]);
  }
  if (paths.size === 0) return text;

  const blocks: string[] = [];
  for (const p of paths) {
    try {
      const abs = resolveInCwd(p, cwd);
      const content = await readFile(abs, 'utf8');
      blocks.push(`[文件 ${p}]\n${truncateOutput(content, maxChars)}`);
    } catch (e) {
      blocks.push(`[文件 ${p}] (读取失败: ${(e as Error).message})`);
    }
  }
  return `${text}\n\n${blocks.join('\n\n')}`;
}
