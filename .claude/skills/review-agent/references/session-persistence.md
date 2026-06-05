# Session 持久化审查标准

## 核心问题

Agent 对话需要持久化以支持：断点续聊、崩溃恢复、历史回溯。

## 审查 Checklist

### 1. 存储格式 ✅

**推荐：JSONL（JSON Lines）**

```
{"type":"message","role":"user","content":"...","timestamp":1234567890}
{"type":"message","role":"assistant","content":"...","timestamp":1234567891}
{"type":"tool_use","name":"read_file","input":{...},"timestamp":1234567892}
{"type":"tool_result","content":"...","timestamp":1234567893}
```

优势：
- Append-only，崩溃安全（最多丢失最后一条）
- 流式写入，无需加载全部内容
- 易于 grep/tail 调试

- [ ] 是否使用 append-only 格式？
- [ ] 崩溃后是否能恢复到最后完整状态？
- [ ] 是否有 session 元数据（创建时间、模型、配置）？

### 2. Prompt Pipe 模式 ✅

System Prompt 模块化组装：

```typescript
type PromptPipe = (ctx: SessionContext) => string | null

// 每个 Pipe 是独立的、可条件加载的模块
const pipes: PromptPipe[] = [
  // 静态层（利于 Cache）
  (ctx) => IDENTITY_PROMPT,
  (ctx) => TOOL_INSTRUCTIONS,

  // 动态层（按需加载）
  (ctx) => ctx.projectRoot ? loadClaudeMd(ctx.projectRoot) : null,
  (ctx) => ctx.activeSkill ? loadSkillPrompt(ctx.activeSkill) : null,
  (ctx) => ctx.memory ? formatMemory(ctx.memory) : null,
]
```

- [ ] Prompt 是否分为静态层和动态层？
- [ ] 各模块是否有明确的加载条件？
- [ ] 是否支持运行时动态增减模块？

### 3. Skills 三层渐进加载 ✅

Skills 是 Prompt Pipe 的扩展形式，避免大量 skill 挤爆上下文：

| 层级 | 内容 | Token 消耗 |
|------|------|-----------|
| Level 1: Frontmatter | name/description/when_to_use | ~100 token/skill |
| Level 2: 完整 SKILL.md | 最佳实践、代码示例、陷阱 | 按需加载 |
| Level 3: references/ scripts/ | 参考文档、可执行脚本 | 按需 Read 工具读取 |

- [ ] 所有 skill 是否只在启动时加载 frontmatter？
- [ ] 完整内容是否按相关性判断后才加载？
- [ ] skill frontmatter 中是否有 `when_to_use` 字段？

### 4. Memory Flush（压缩前先存档）✅

上下文压缩会丢信息，压缩前必须先把重要信息写入长期记忆：

```
触发条件：
  软阈值：已用 token >= (窗口 - reserveTokensFloor - 4000)
  强制阈值：transcript 文件 > 2MB

流程：Memory Flush → 上下文压缩
```

- [ ] 压缩前是否有 Memory Flush 步骤？
- [ ] 长期记忆是否有结构化格式（name/description/type）？

### 5. 会话生命周期 ✅

```
创建 → 活跃 → 暂停 → 恢复 → 归档
```

- [ ] 是否有会话超时机制？
- [ ] 恢复时是否重建完整上下文？
- [ ] 归档会话是否可查询但不占活跃资源？

### 6. 并发与锁 ✅

- [ ] 同一会话是否防止并发写入？
- [ ] 多设备访问同一会话是否有冲突处理？

## 反模式

| 反模式 | 问题 | 正确做法 |
|--------|------|----------|
| 全量 JSON 覆写 | 崩溃丢失全部 | JSONL append-only |
| 内存中不持久化 | 进程退出即丢失 | 实时写入磁盘/DB |
| 巨型单文件 prompt | 不可维护 | Prompt Pipe 模块化 |
| 恢复时不压缩 | 历史太长超限 | 恢复时触发压缩 |
| 压缩前不 flush | 信息永久丢失 | Memory Flush 前置 |
| 所有 skill 全量加载 | Token 爆炸 | 三层渐进加载 |

## 评分标准

- ⭐⭐⭐⭐⭐：JSONL + Prompt Pipe + 崩溃恢复 + Memory Flush + Skills 渐进加载
- ⭐⭐⭐⭐：有持久化和模块化 prompt，缺崩溃恢复
- ⭐⭐⭐：有基本持久化，prompt 未模块化
- ⭐⭐：仅内存存储，重启丢失
- ⭐：无持久化


## 审查 Checklist

### 1. 存储格式 ✅

**推荐：JSONL（JSON Lines）**

```
{"type":"message","role":"user","content":"...","timestamp":1234567890}
{"type":"message","role":"assistant","content":"...","timestamp":1234567891}
{"type":"tool_use","name":"read_file","input":{...},"timestamp":1234567892}
{"type":"tool_result","content":"...","timestamp":1234567893}
```

优势：
- Append-only，崩溃安全（最多丢失最后一条）
- 流式写入，无需加载全部内容
- 易于 grep/tail 调试

- [ ] 是否使用 append-only 格式？
- [ ] 崩溃后是否能恢复到最后完整状态？
- [ ] 是否有 session 元数据（创建时间、模型、配置）？

### 2. Prompt Pipe 模式 ✅

System Prompt 模块化组装：

```typescript
type PromptPipe = (ctx: SessionContext) => string | null

// 每个 Pipe 是独立的、可条件加载的模块
const pipes: PromptPipe[] = [
  // 静态层（利于 Cache）
  (ctx) => IDENTITY_PROMPT,
  (ctx) => TOOL_INSTRUCTIONS,

  // 动态层（按需加载）
  (ctx) => ctx.projectRoot ? loadClaudeMd(ctx.projectRoot) : null,
  (ctx) => ctx.activeSkill ? loadSkillPrompt(ctx.activeSkill) : null,
  (ctx) => ctx.memory ? formatMemory(ctx.memory) : null,
]
```

- [ ] Prompt 是否分为静态层和动态层？
- [ ] 各模块是否有明确的加载条件？
- [ ] 是否支持运行时动态增减模块？

### 3. 会话生命周期 ✅

```
创建 → 活跃 → 暂停 → 恢复 → 归档
```

- [ ] 是否有会话超时机制？
- [ ] 恢复时是否重建完整上下文？
- [ ] 归档会话是否可查询但不占活跃资源？

### 4. 并发与锁 ✅

- [ ] 同一会话是否防止并发写入？
- [ ] 多设备访问同一会话是否有冲突处理？

## 反模式

| 反模式 | 问题 | 正确做法 |
|--------|------|----------|
| 全量 JSON 覆写 | 崩溃丢失全部 | JSONL append-only |
| 内存中不持久化 | 进程退出即丢失 | 实时写入磁盘/DB |
| 巨型单文件 prompt | 不可维护 | Prompt Pipe 模块化 |
| 恢复时不压缩 | 历史太长超限 | 恢复时触发压缩 |

## 评分标准

- ⭐⭐⭐⭐⭐：JSONL + Prompt Pipe + 崩溃恢复 + 生命周期管理
- ⭐⭐⭐⭐：有持久化和模块化 prompt，缺崩溃恢复
- ⭐⭐⭐：有基本持久化，prompt 未模块化
- ⭐⭐：仅内存存储，重启丢失
- ⭐：无持久化
