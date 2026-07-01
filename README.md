# zent

**zent** 是一个用于**学习 AI Agent 原理**的极简本地编码 Agent：单列 TUI（Ink）+ 原生 tool calling（OpenAI 兼容协议）+ 流式输出。设计哲学对标 Claude Code——单列、低噪音、内容优先。核心目标是把 agent loop 看透：`core/` 是一个**零 UI 依赖、可独立运行/单测**的纯逻辑引擎。

## 特性

- 交互式 REPL（Ink TUI），单列垂直流，工具调用以 `⏺`/`⎿` 树形呈现
- Markdown 渲染：标题 / 列表 / 代码块 / **粗体** / `行内代码` / **表格**
- 原生 tool calling + 流式输出，OpenAI 兼容协议（默认模型 kimi-for-coding）
- 6 个工具：读 / 写 / 精确编辑 / 执行 shell / 任务规划 / 结束
- 危险操作（写文件、编辑、执行命令）执行前人工 `y/n` 审批
- agent loop 与 UI 彻底解耦：`runAgent()` 是一个 `async generator`，可脱离 Ink 单跑/单测
- 上下文管理：滑动窗口截断 + 大输出截断
- 会话写入 JSONL 日志，便于复盘 Agent 决策过程

## 架构

```
bin/cli.tsx → src/index.tsx (bootstrap)
src/core/          纯逻辑，零 React 依赖
  agent.ts         loop 引擎: async function* runAgent() —— yield 事件，next() 回传审批
  stream.ts        流式 tool_calls 分片重组
  providers/       createLLMClient 工厂 (openai.ts；anthropic/ollama 预留)
  tools/           注册表 + 6 工具 (read/write/edit/run_shell/update_plan/finish)
  context/         截断 (滑动窗口 + 大输出截断)
  prompt.ts        system prompt 模板
  events.ts / types.ts / logger.ts / cost.ts
src/tui/           Ink 表现层（单列），只订阅事件
  App.tsx          单列布局 + 焦点状态机
  useAgent.ts      桥: 消费 generator → React state；卸载时 abort + return
  ConversationView / StatusBar / Spinner / InputBox / markdown
scripts/runHeadless.ts   无 UI 跑 loop —— 主调试场
tests/core/        bun test (mock provider + 临时目录)
```

核心原则：`core/` 绝不 import `tui/` 或 React。同一个 `runAgent()` 既被 Ink 的 `useAgent` 消费，也被 headless 脚本用纯 `for await` 消费。

## 快速开始

依赖：[Bun](https://bun.sh) ≥ 1.3。

```bash
bun install

# 1) 配置凭据（不入库，放在用户目录）
mkdir -p ~/.zent
cp config.example.json ~/.zent/config.json
# 编辑 ~/.zent/config.json 填入 baseUrl / apiKey / model

# 2) 启动 TUI（在真实终端中运行）
bun run bin/cli.tsx

# 审批模式
bun run bin/cli.tsx --yolo                    # full-auto：跳过所有危险工具审批
bun run bin/cli.tsx --approval-mode suggest   # suggest：先只读探索，确认计划后自动放行
bun run bin/cli.tsx --approval-mode manual    # manual（默认）：每次危险工具都确认

# 无 UI 跑通 loop（验证核心逻辑、调 prompt 的主战场）
bun run scripts/runHeadless.ts "读取 README.md 并在末尾追加一行"
bun run scripts/runHeadless.ts --auto "<任务>"   # 自动批准危险工具

# 测试 / 类型检查 / 打包
bun test
bunx tsc --noEmit
bun build --compile bin/cli.tsx --outfile zent

# 端到端 smoke 测试（需要真实 API，建议加 --yolo 自动审批）
bun run scripts/e2e.ts --yolo
```

也可用环境变量 `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `MODEL`，或 CLI 参数 `--model` / `--config` / `--base-url` / `--cwd` / `--approval-mode` / `--yolo` 覆盖配置。

## TUI 交互

- 输入框：多行（回车提交；行尾 `\` 换行；`@` 触发文件补全，选中后内容注入上下文）；`↑/↓` 回溯历史命令
- 运行时：spinner 显示 `Working… (耗时 · tokens)`；`Esc` 中断当前任务
- `Ctrl+O`：展开最近一条工具的详细输出
- `Esc`（空闲时）：进入审查模式（`↑/↓` 选择工具，`Enter` 折叠/展开，再 `Esc` 返回）
- 危险工具执行前需 `y/n` 审批
- 底部状态栏：`tokens (占比) · 目录 · 模型 · 成本`

## 工具集

| 工具 | 副作用 | 说明 |
|---|---|---|
| `read_file` | 否 | 读文件 |
| `write_file` | 是 | 整文件覆盖（必要时建目录） |
| `edit_file` | 是 | 精确字符串替换（严格匹配；多匹配报错；返回 diff 摘要） |
| `run_shell` | 是 | 在工作目录执行命令 |
| `update_plan` | 否 | 声明/更新任务计划（内联渲染为 checklist） |
| `finish` | 否 | 结束任务并给出总结 |

所有文件/命令操作限定在工作目录内（越界路径被拒绝）。

## 配置项

`~/.zent/config.json`：

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseUrl` | — | OpenAI 兼容端点（必填） |
| `apiKey` | — | API Key（必填，不入库） |
| `model` | — | 模型名（必填） |
| `maxIterations` | 25 | loop 最大迭代次数 |
| `maxToolOutputChars` | 4000 | 单条工具输出回灌截断阈值 |
| `keepRecentTurns` | 20 | 历史滑动窗口保留轮数 |
| `contextWindow` | 128000 | 上下文窗口（状态栏占比用） |
| `approvalMode` | `manual` | 危险工具审批模式：`manual` / `suggest` / `full-auto` |
| `shellSafety` | `strict` | `strict` 启用完整默认黑名单，`permissive` 只拦截最危险命令 |
| `shellBlacklist` | `[]` | 额外黑名单正则字符串数组 |
| `shellWhitelist` | `[]` | 白名单正则字符串数组，命中则跳过黑名单检查 |
| `allowShellRedirectOutsideCwd` | `false` | 是否允许输出重定向到工作目录外 |
| `enableSummarization` | `true` | token 接近阈值时是否自动摘要旧历史 |
| `summarizeThreshold` | `0.7` | 触发摘要的上下文窗口占比 (0..1) |
| `summarizeMinMessages` | `6` | 摘要时至少保留多少条最近消息不压缩 |
| `pricing` | 可选 | `{input, output}` 每百万 token 价；留空则不计成本 |

## 会话日志

每次会话写入 `~/.zent/sessions/<timestamp>.jsonl`，记录事件与消息，便于事后复盘。当前版本不支持会话恢复。

## 设计取舍（阶段 A）

本版聚焦"看透 agent loop"与单列 TUI 体验。未实现（留待后续）：会话恢复、上下文摘要压缩、多 provider 实际接入、容器级沙箱。`edit_file` 宽容匹配与 full-auto/suggest 多审批模式已在阶段 B 实现。

## License

MIT
