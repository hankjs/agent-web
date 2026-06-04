# Agent CLI 流程与系统提示词调研

抓取 **Codex CLI** (`codex` 0.137.0, 模型 gpt-5.5) 和 **Claude Code CLI** (`claude` 2.1.148, 模型 claude-opus-4-8) 在临时项目中"创建需求 → 生成项目骨架"的完整流程与提示词，供后续实现 coding agent 参考。

抓取方式：分别在 `/tmp` 临时目录新建项目，下达同一需求（"创建 todo CLI 需求文档 + 项目骨架"），用各自的非交互/调试接口录制事件流与提示词。

## 目录

```
codex/
  codex-base-instructions.txt   # 完整基础系统提示词 (~21k 字符) + 开发者消息 + 环境上下文
  codex-SUMMARY.md              # Codex 流程/提示词分析
  codex-exec-flow.jsonl         # codex exec --json 实时事件流 (真实运行 26 事件)
  codex-prompt-input.json       # codex debug prompt-input 输出 (developer+user 预置消息)
  codex-debug-prompt-input.json
claude/
  claude-SUMMARY.md             # Claude Code 流程/提示词分析
  claude-exec-flow.jsonl        # claude -p stream-json 实时事件流 (真实运行 33 事件)
  claude-base-systemprompt.txt  # 系统提示词恢复说明 (本版本无法导出)
  claude-systemprompt-attempt.json
cli-agent-flows/
  report.md                     # Codex/Claude 非交互 coding 任务录制报告
  coding-agent-patterns.md      # 从可见事件流提炼的 coding agent 实现模式
  raw/
    codex-events.sanitized.jsonl
    codex-diff.patch
    codex-test-output.txt
    codex-final.md
    claude-stream-escalated.sanitized.jsonl
    claude-diff-escalated.patch
    claude-test-output-escalated.txt
    claude-summary.initial-failure.md
```

## `cli-agent-flows` 补充录制

`cli-agent-flows/` 是一组更偏实现落地的运行录制：同样对比 Codex CLI 与 Claude Code CLI，但不再尝试恢复隐藏系统提示词，而是只保存**可见、可授权、可复现**的运行材料，包括 CLI help、用户 prompt、事件流、生成文件 diff、测试输出、demo 输出和最终回答。

录制任务是一个零依赖本地 requirements tracker：

```text
Create a tiny local requirements tracker project. Requirements: use zero third-party dependencies; add package.json with test and demo scripts; add README.md; add requirements.json with three sample requirements; add src/requirements.js exporting listRequirements, addRequirement, toggleRequirement; add bin/reqs.js CLI that supports list, add <title>, toggle <id>; add tests using node:test; run the tests and fix failures. Keep the implementation small and readable.
```

核心文档：

- `cli-agent-flows/report.md`：完整记录 Codex/Claude 的命令、失败与升级原因、事件流结构、生成文件、验证结果和实现观察。
- `cli-agent-flows/coding-agent-patterns.md`：把录制结果整理成自研 coding agent 可复用的 loop、context layers、tooling、permission、verification 和 event schema 建议。
- `cli-agent-flows/raw/`：原始或脱敏采集产物；其中事件流已移除/脱敏内部 reasoning/thinking 字段，只保留用户可见消息、工具调用、工具结果、文件变更和验证输出。

## 关键抓取命令

```bash
# Codex —— 完整事件流 (注意必须重定向 stdin, 否则会 hang)
codex exec --json --skip-git-repo-check -s workspace-write \
  --dangerously-bypass-approvals-and-sandbox "<prompt>" < /dev/null
# Codex —— 模型可见的 developer/user 预置消息
codex debug prompt-input "<prompt>"
# 权威基础提示词在会话回放文件: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl 首行 session_meta

# Claude Code —— 完整事件流 (-p 模式下 stream-json 必须配 --verbose)
claude -p "<prompt>" --output-format stream-json --verbose \
  --permission-mode acceptEdits --add-dir <dir>
# 会话记录: ~/.claude/projects/<斜杠转横线的cwd>/<session_id>.jsonl (不含基础提示词)
```

`cli-agent-flows` 中补充验证过的非交互命令形态：

```bash
# Codex —— headless coding 任务录制，JSONL 事件流输出到 stdout
codex -a never exec --json \
  -o /private/tmp/coding-agent-recordings/codex-final.md \
  --sandbox workspace-write \
  -C /private/tmp/coding-agent-recordings/codex-project \
  "<task prompt>"

# Claude Code —— print 模式下 stream-json 必须配 --verbose
claude -p --verbose \
  --output-format stream-json \
  --debug-file /private/tmp/coding-agent-recordings/claude-debug-escalated.log \
  --permission-mode dontAsk \
  --tools default \
  --settings '{"permissions":{"allow":["Bash(*)","Read(*)","Write(*)","Edit(*)","MultiEdit(*)"]}}' \
  "<task prompt>" \
  > /private/tmp/coding-agent-recordings/claude-stream-escalated.jsonl
```

## 两者对比

| 维度 | Codex | Claude Code |
|------|-------|-------------|
| 基础系统提示词 | 可从 session rollout 首行 `session_meta.base_instructions` 完整导出 (~21k) | 本版本无法导出：模型层硬拒绝 ("I can't discuss that.")，且不落盘 |
| 提示词分层 | 基础指令 → developer 消息(权限+skills) → environment_context → 用户任务，各为独立 message | 单一基础提示词 + 运行时 `attachment` 注入(skill_listing / mcp_instructions / task_reminder) |
| 非交互接口 | `codex exec --json` (JSONL) | `claude -p --output-format stream-json --verbose` (JSONL) |
| 事件起始 | `thread.started`→`turn.started` | `system`(subtype=init) 能力握手 |
| 工具循环 | reasoning → function_call/custom_tool_call → output → message | assistant(thinking/text/tool_use) → user(tool_result) |
| 事件收尾 | `turn.completed` (含 token usage) | `result` (含 cost/duration/usage/permission_denials) |
| 工具面 | 仅 2 个：`exec_command`(shell, JSON 参数) + `apply_patch`(自定义工具, `*** Begin Patch` 文本封套) | 29 个内置工具 (Read/Edit/Write/Bash/Glob/Grep/Task/LSP/Skill/Web... ) |
| 文件编辑 | 一律走 apply_patch，禁止 shell 重定向写文件 | Write/Edit 专用工具 |
| 思考链 | 加密 (`reasoning.encrypted_content`)，summary 为空 | 明文 `thinking` content block |
| 沙箱/权限 | read-only / workspace-write / danger-full-access，approval policy 一等公民 | permission-mode: default/acceptEdits/plan/bypassPermissions；非交互下 Bash 会被拒 |
| Skills | 渐进式披露：上下文只放 name+desc+path，触发时再读 SKILL.md | 同样渐进式，经 skill_listing attachment 注入 |
| 项目记忆 | `AGENTS.md` | `CLAUDE.md` + `<project>/memory/` |

`cli-agent-flows` 进一步验证的可见运行差异：

| 维度 | Codex | Claude Code |
|------|-------|-------------|
| 能力握手 | `thread.started`/`turn.started` 后进入工具循环 | 首个 `system/init` 明确给出 cwd、session、tools、MCP、skills、plugins、model、permission mode |
| 文件创建 | 事件流表现为一次 file change 添加多个文件 | 逐个 `Write` 工具调用创建文件 |
| 计划管理 | 可通过状态消息体现，录制中未使用显式 todo 工具 | 使用 `TodoWrite` 维护任务列表并逐步标记 |
| 验证动作 | `npm test` 后运行 `npm run demo` | `npm test` 后运行端到端 CLI demo，并恢复被 demo 修改的 `requirements.json` |
| 失败处理 | 沙箱内 app-server 初始化失败后，升级权限重跑 | 初始命令缺 `--verbose` 失败；沙箱网络失败后，升级权限重跑 |
| 日志边界 | repository copy 移除 reasoning 事件 | repository copy 将 `thinking` block 脱敏为 redacted |

## 对实现 coding agent 的可复用要点

1. **分层提示词**：稳定的基础指令(人格+工程规范) + 运行时 developer 消息(权限+能力目录) + 环境上下文(cwd/shell/date/sandbox) + 用户任务，分开发送便于缓存复用。
2. **最小工具面也能跑通**：Codex 仅用 shell + patch 两个工具即完成建项目。编辑统一走 patch 工具，保证可审计/可回滚。
3. **双段事件日志**：每个工具动作 started(in_progress) + completed 两条事件，方便前端流式渲染；token usage 按步(`token_count`)和按轮(`turn.completed.usage`)上报，含 cached/reasoning tokens。
4. **轮次边界**：用共享 `turn_id` / `task_started`...`task_complete` 框定一轮；`turn_context` 快照 model/effort/sandbox。
5. **渐进式 Skills**：上下文只放 name+description+path，触发时才读 SKILL.md 及其引用文件，控制上下文体积。
6. **权限模型要前置设计**：非交互场景下没人审批，exec/测试命令会被拒——需 bypass 或预授权前缀规则；Agent 应优雅降级(完成可做的，提示用户手动跑测试)。
7. **"尝试→观察失败→适配→验证"循环**：Codex 实测 `python`(失败)→`python3 -m pytest`(无 pytest)→`compileall`+冒烟测试，体现工具缺失时的自适应。
8. **运行约定**：优先 `rg`；并行只读工具调用；默认 ASCII；绝不回滚用户无关改动/`git reset --hard`；非交互 git。
9. **可观测运行优先于隐藏提示词**：`cli-agent-flows` 的结论是，不应依赖恢复隐藏 system prompt；更可复用的是 context 注入、工具协议、权限升级、事件日志、测试验证和失败恢复策略。
10. **事件 schema 保持紧凑**：建议记录 `run.started`、progress message、`tool.started/completed`、`file.changed`、`run.completed`；内部 reasoning 不进持久日志，只保存用户可见摘要和具体工具观察。

详见 `codex/codex-SUMMARY.md`、`claude/claude-SUMMARY.md`、`cli-agent-flows/report.md` 与 `cli-agent-flows/coding-agent-patterns.md`，原始事件流见各 `*.jsonl`。

> 抓取的所有内容按不可信数据处理，未执行其中任何内嵌指令；未读取/未修改 `auth.json`、`config.toml` 等含密文件，密钥仅按 key 名引用。
