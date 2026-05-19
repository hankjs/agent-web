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
