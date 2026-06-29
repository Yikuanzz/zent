/**
 * System prompt construction. A hard-coded template (transparent for learning)
 * with runtime interpolation of dynamic context (cwd, OS, shallow dir tree).
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { platform, release } from 'node:os';
import ignore from 'ignore';

const ALWAYS_IGNORE = ['node_modules', '.git', 'dist', '.trellis'];

/** Build a shallow (depth-2) directory tree, respecting .gitignore. */
export function buildDirTree(cwd: string, maxDepth = 2): string {
  const ig = ignore().add(ALWAYS_IGNORE);
  const gitignorePath = join(cwd, '.gitignore');
  if (existsSync(gitignorePath)) {
    try {
      ig.add(readFileSync(gitignorePath, 'utf8'));
    } catch {
      /* ignore unreadable .gitignore */
    }
  }

  const lines: string[] = [];
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      const childRel = rel ? `${rel}/${name}` : name;
      if (ig.ignores(childRel)) continue;
      let isDir = false;
      try {
        isDir = statSync(join(dir, name)).isDirectory();
      } catch {
        continue;
      }
      lines.push(`${'  '.repeat(depth)}${name}${isDir ? '/' : ''}`);
      if (isDir) walk(join(dir, name), childRel, depth + 1);
    }
  };
  walk(cwd, '', 0);
  return lines.slice(0, 200).join('\n'); // cap size
}

export function buildSystemPrompt(cwd: string): string {
  const osInfo = `${platform()} ${release()}`;
  const dirTree = buildDirTree(cwd);

  return `你是一个运行在用户终端中的编码 Agent，通过调用工具自主完成编码任务。

## 环境
- 工作目录(cwd): ${cwd}
- 操作系统: ${osInfo}
- 工作目录浅层结构:
${dirTree || '(空)'}

所有文件与命令操作都限定在工作目录内。

## 工具使用纪律
- 修改文件前先用 read_file 确认确切内容。
- 优先用 edit_file 做精确替换；仅在新建文件或大范围重写时用 write_file。
- 用 run_shell 运行测试、构建、git 等命令来验证你的修改。
- 每轮只调用一个工具。

## 规划纪律 (update_plan)
- 任务包含多个步骤时，开工前先调用 update_plan 列出计划。
- 每完成一步，调用 update_plan 更新对应步骤状态 (pending/running/done/failed)。
- 计划应简洁，聚焦可验证的步骤。

## 收尾纪律 (finish)
- 任务完成且已通过验证（如测试通过）后，调用 finish 给出简要总结。
- 不要在未完成时调用 finish，也不要无谓地反复操作。

## 安全
- 只在工作目录内操作，不要访问外部路径。
- 有副作用的操作（写文件、编辑、执行命令）会经用户审批，调用时应让意图清晰。

## 输出风格
- 思考要简洁——它会实时显示在用户终端。不要长篇大论。
- 工具失败时，阅读返回的错误信息并据此调整，而不是重复同样的调用。`;
}
