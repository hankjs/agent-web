# ExploreAgent 逻辑与数据流

## 分层架构

```
useExploreAgent (核心循环 + 状态)
  ├── llm.ts (LLM 通信 + 工具执行)
  ├── prompts.ts (模板填充)
  ├── tools.ts (工具 schema)
  ├── localTools.ts (Tauri 本地执行)
  └── types.ts (类型定义)

useAgentBlocks (Block 聚合层)
  ├── useBlockEvents (Block 列表管理 + 合并逻辑)
  ├── useAskUserInteraction (用户回答 → 文本序列化)
  └── useBlockHistory (后端事件 → Block 还原)
```

---

## 1. useExploreAgent — 核心循环

### 状态

```typescript
{
  phase: "idle" | "thinking" | "acting" | "observing" | "waiting_user" | "done" | "cancelled",
  runningSummary: string,      // 滚动压缩摘要
  findings: Finding[],         // 累积发现
  uncoveredAreas: string[],    // 待覆盖关注点 (来自 metadata.focusAreas)
  turnCount: number,           // Planner 调用次数
}
```

### reactLoop 数据流

```
handleUserInput(content, images?)
  │
  ├─ onBlock({ kind: "user", content })        ← 原样透传
  ├─ logEvent("explore:answer", { content })   ← 持久化到后端
  │
  └─ reactLoop(content, images)
       │
       ├─ runPlannerStep(userInput, images)
       │    输入格式化:
       │      buildExplorePlannerPrompt({
       │        summary: state.runningSummary || "（尚未开始探索）",
       │        uncoveredAreas: areas.join("、") || "由 agent 根据上下文判断",
       │        userInput: content,
       │        turnCount, maxTurns: HARD_MAX_READS,
       │        findingsCount: findings.length,
       │        elapsedSec: Math.round(elapsed / 1000),
       │      })
       │    调用: callLLM(system="JSON输出机器", prompt, images)
       │    输出解析: response → 正则提取 JSON → PlannerAction { reasoning, action, params }
       │    副作用: onBlock(thinking) 流式更新
       │
       ├─ action="read_code" → executeReadCode(params, reasoning)
       ├─ action="ask_user" → emitAskUser(params)  → phase="waiting_user", 退出循环
       └─ action="finalize" → executeFinalize(params)
```

如果当前处于 Reader 工具循环内的 `AskUserQuestion` 暂停点，`handleUserInput` 不启动新一轮
`reactLoop`，而是:

```
answerResolver 存在
  ├─ onBlock({ kind: "user", content })
  ├─ logEvent("explore:answer", { content })
  └─ resolveAnswer(content) → 恢复 Reader 工具循环
```

### executeReadCode 数据流

```
executeReadCode({ objective, files_hint }, reasoning)
  │
  ├─ onBlock({ kind: "explore_round", objective, reasoning, tools:[], isRunning:true })
  │
  ├─ 构建 system prompt:
  │    buildExploreReaderPrompt({
  │      objective: objective + (files_hint ? "\n提示文件: " + files_hint.join(", ") : ""),
  │      workDir: options.workDir,
  │    })
  │
  ├─ messages = [{ role:"user", content:[{type:"text", text:"开始阅读。"}] }]
  │
  └─ 循环 (最多 MAX_TOOL_ROUNDS=5 轮):
       │
       ├─ callLLMWithTools(system, trimMessages(messages), READER_TOOLS)
       │    返回: { text, toolCalls: ToolUseBlock[], stopReason, meta }
       │
       ├─ toolCalls.length === 0 → 解析 text 中的 findings → applyFindings → return
       │
       ├─ 构建 assistant message:
       │    content = [text块, ...toolUse块]
       │    每个 toolUse: { type:"tool_use", id, name, input }
       │
       ├─ 执行每个 tool:
       │    ├─ report_findings → 直接提取 input.findings → earlyFindings
       │    ├─ AskUserQuestion
       │    │    ├─ onBlock(ask_user)
       │    │    ├─ logEvent("explore:question", { questions })
       │    │    ├─ onStreaming(false) → 允许用户操作问答卡片
       │    │    └─ waitForAnswer() 暂停 → 收到回答后 onStreaming(true)
       │    └─ 其他 → execTool(name, input, workDir)
       │         返回: { content: string, is_error: boolean, duration_ms }
       │         onBlock(tool) 更新结果
       │
       └─ 构建 user message (tool_results):
            [{ type:"tool_result", tool_use_id, content, is_error }]
```

### applyFindings 数据流

```
applyFindings(findings: Finding[], rawText)
  │
  ├─ 格式化 newText:
  │    findings.map(f => `[${f.topic}] ${f.content} (${f.source})`).join("\n")
  │    或 rawText.slice(0, 300) (无 findings 时)
  │
  ├─ state.findings.push(...findings)
  │
  ├─ 过滤 uncoveredAreas: 移除 topic/content 中包含的关注点
  │
  └─ combined = runningSummary + "\n" + newText
       ├─ estimateTokens(combined) > threshold → compressSummary(newText)
       └─ 否则 → runningSummary = combined
```

### compressSummary 数据流

```
compressSummary(newText)
  │
  ├─ prompt = buildExploreSummarizerPrompt({
  │    currentSummary: runningSummary || "（空）",
  │    newFindings: newText,
  │  })
  │
  ├─ callLLM("文本压缩助手", prompt)
  │    返回: compressed text
  │
  ├─ 动态校准 threshold:
  │    ratio = actualTokensIn / estimatedTokens
  │    偏差 > 30% → threshold *= ratio (clamp 400~1500)
  │
  └─ runningSummary = compressed.trim()
```

### executeFinalize 数据流

```
executeFinalize({ title })
  │
  ├─ onBlock({ kind:"text", content: "探索完成: ${title}" })
  │
  └─ POST /api/changes
       body: {
         name: title,
         explore_summary: state.runningSummary,
         session_id: options.sessionId,
       }
      成功后 logEvent("explore:complete", { title, summary })
```

`executeFinalize` 不再额外写入 `explore:status` 的完成消息，避免历史还原时和
`explore:complete` 重复。

### 运行控制与保护

当前实现包含几类保护逻辑:

- `cancel()` 会 abort 当前 LLM 请求，设置 `phase="cancelled"`，追加“探索已取消。”文本，并触发 `onComplete()`。
- Planner 最多重试 2 次；空响应、无 JSON、JSON 解析失败都会记录 `explore:planner_retry` / `explore:error`。
- LLM 通信层对 retryable 错误最多重试 3 次，使用指数退避和 jitter。
- 读取轮数受 `metadata.depth` 限制: `quick=4`、`standard=8`、`deep=15`，硬上限 `HARD_MAX_READS=20`。
- 连续两轮无新增 findings 会询问用户是否继续。
- Reader 连续错误达到阈值会跳过当前 objective，多次降级后询问用户是否继续。
- Reader 工具消息使用 sliding window，仅保留最近 `MAX_FULL_ROUNDS=3` 轮完整工具上下文，旧轮次压缩成工具名摘要。

---

## 2. llm.ts — 通信层数据格式化

### callLLM (纯文本补全)

```
输入 → 请求体:
{
  system: string,
  messages: [{ role:"user", content: [
    ...images.map(img => ({ type:"image", source:{type:"base64", media_type, data} })),
    { type:"text", text: userText }
  ]}],
  tools: [],
  max_tokens: 4096
}

SSE 事件流 → 解析:
  "text_delta"  → 累积 text, 调用 onDelta
  "usage"       → { input_tokens, output_tokens }
  "error"       → reject

输出: { text, meta: { tokens_in, tokens_out, latency_ms }, httpStatus }
```

通信通道:

- Tauri 环境通过 `llm_stream` invoke + `llm-stream-event` 事件流式接收。
- 浏览器开发环境通过 XHR 读取 `text/event-stream`。

### callLLMWithTools (带工具)

```
输入 → 请求体:
{
  system, messages: LlmMessage[], tools: ToolSchema[], max_tokens: 4096
}

SSE 事件流 → 解析:
  "text_delta"       → 累积 text
  "tool_use_start"   → 开始收集 { id, name, inputJson:"" }
  "tool_use_input_delta" → inputJson += delta
  "tool_use_end"     → JSON.parse(inputJson) → toolCalls.push({ type:"tool_use", id, name, input })
  "message_end"      → stopReason
  "usage"            → meta

输出: { text, toolCalls: ToolUseBlock[], stopReason, meta }
```

### execTool (工具执行路由)

```
Tauri 环境 → invoke("tool_read_file" | "tool_grep" | "tool_glob" | ...)
  参数映射:
    read_file → { path, workDir, offset, limit }
    search    → { pattern, path, workDir, glob, ignoreCase }
    glob      → { pattern, path, workDir }
    edit      → { path, oldString, newString, workDir }
    write_file → { path, content, workDir }
    bash      → { command, workDir, timeoutMs }

浏览器环境 → POST /api/llm/tool-exec
  body: { tool: name, input, work_dir: workDir }

统一输出: { content: string, is_error: boolean, duration_ms: number }
```

---

## 3. useBlockEvents — Block 合并逻辑

onBlock 接收 Block 时的处理规则:

| 输入 Block | 合并行为 |
|---|---|
| thinking | 已有 thinking → 更新 content; 否则 push |
| tool | 最后一个 block 是 explore_round → 合并到 tools 数组; 否则查找同 id 更新 |
| explore_round / ask_user / "探索完成" text | 清除已有 thinking block |
| 其他 | 直接 push |

---

## 4. useAskUserInteraction — 回答序列化

```
用户选择/输入 → submitAskUser(block)
  │
  ├─ 序列化: block.questions.map(q => q.customMode ? q.customAnswer : q.selected).join("; ")
  │
  ├─ exploreAgent.resume()  → phase 从 waiting_user 回到 idle
  │
  └─ exploreAgent.handleUserInput(answers)
       → 如果 answerResolver 存在 (Reader 层暂停): resolveAnswer(answers) 恢复 Promise
       → 否则: 作为新一轮 reactLoop 输入
```

---

## 5. useBlockHistory — 事件还原为 Block

后端事件 → Block 映射:

| event_type | 还原为 Block |
|---|---|
| explore:answer | { kind:"user", content: p.content } |
| explore:action (read_code) | { kind:"explore_round", objective, reasoning, tools:[] } |
| explore:tool_call | 追加到当前 round.tools: { id, name, input: JSON.stringify } |
| explore:tool_result | 更新最后一个 tool: { result: output_preview, isError } |
| explore:status | { kind:"text", content: p.message } (排除 "正在阅读代码:" 前缀) |
| explore:error | { kind:"error", content: p.error } |
| explore:question | { kind:"ask_user", questions, answered: 后续是否有 answer 事件 } |
| explore:complete | { kind:"text", content: "探索完成: ${title}" } |

`explore:status` 还会排除旧数据中的 `"探索完成:"` 前缀，避免和 `explore:complete`
重复显示。

options 格式化: `string → { label: string }` 统一为对象形式。

历史加载过滤条件:

```
source !== "remote" && visibility !== "internal"
```

即 client 侧、非 internal 的事件参与还原；internal 事件仅用于调试和指标。

---

## 6. Prompt 模板变量注入

| 模板 | 变量 | 来源 |
|---|---|---|
| explore-planner.md | summary, uncovered_areas, user_input, turn_count, max_turns, findings_count, elapsed_sec | state + 计算 |
| explore-reader.md | objective, work_dir | PlannerAction.params + options |
| explore-summarizer.md | current_summary, new_findings | state.runningSummary + 格式化的 findings |
| explore.md | project_label, work_dir, depth, question_style, focus_areas | session metadata |
| explore-continue.md | change_name, work_dir, explore_summary | Change 数据 + state |

模板填充: `{{key}}` → 简单正则替换，无转义处理。

---

## 7. 事件持久化格式

logEvent 写入后端 `POST /api/sessions/:id/local-events`:

```json
[{
  "event_type": "explore:action" | "explore:tool_call" | ...,
  "agent_type": "explore_react",
  "payload": { ... },
  "source": "client",
  "visibility": "user" | "internal"
}]
```

visibility="internal" 的事件不参与历史还原；`source="remote"` 的事件也不参与
ExploreAgent 本地事件还原。

---

## 8. Agent.vue 集成要点

- `useExploreAgent` 接收一个 reactive options 对象，`metadata` 和 `workDir` 会随 `currentSession` 同步，避免直接打开 `/agent/:sessionId` 时初始化为空。
- `Agent.vue` mount 时会先 `fetchSessions()`，再按 `sessionId` 找到 session 并同步上下文。
- 输入框 stop 调用 `exploreAgent.cancel()`，不是只清 UI streaming 状态。
- `ask_user` 卡片在 `phase="waiting_user"` 时可交互，即使前一轮 agent 流程曾处于 streaming 状态。
