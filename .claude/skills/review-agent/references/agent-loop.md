# Agent Loop 审查标准

## 核心模型：ReAct 循环

Agent 的本质是一个 while 循环，执行 Think → Act → Observe 的 ReAct 模式：

```
while (true) {
  response = llm.call(messages)      // Think
  if (response.stopReason === 'end_turn') break  // 终止判断
  toolResults = execute(response.toolCalls)       // Act
  messages.push(toolResults)                      // Observe
}
```

## 审查 Checklist

### 1. 终止条件 ✅

- [ ] 有明确的 `maxTurns` 上限（推荐 50-200，视场景而定）
- [ ] 有 `maxTokens` 总预算上限
- [ ] 正确识别 stop_reason（`end_turn` / `stop` 表示模型主动结束）
- [ ] 区分 `max_tokens` stop（被截断）和 `end_turn`（主动结束）
- [ ] 被截断时有恢复策略（续写或提示用户）

### 2. 死循环检测 ✅

**双指纹检测法**：同时记录调用指纹和结果指纹，只有「同样调用 + 同样结果」才算无进展

```typescript
// 推荐实现
interface LoopDetector {
  // 调用指纹：tool_name + hash(args)
  callFingerprint(toolCall: ToolCall): string
  // 结果指纹：hash(tool_result_content)
  resultFingerprint(result: ToolResult): string
  // 组合指纹：两者都相同才记为重复
  combinedFingerprint(call: ToolCall, result: ToolResult): string
  detect(history: string[]): boolean  // 滑动窗口检测重复
}
```

检测策略：
- 连续 3+ 次「调用指纹 + 结果指纹」完全相同 → 死循环（同样调用 + 同样结果 = 真正无进展）
- 仅调用指纹相同但结果不同（如轮询场景）→ **不算**死循环
- 滑动窗口内组合重复率 > 70% → 疑似循环
- 检测到后：注入 nudge 消息提醒模型换策略，而非直接终止

### 3. Token 预算管理 ✅

```typescript
interface TokenBudget {
  maxInputTokens: number    // 单次请求上限
  maxOutputTokens: number   // 单次输出上限
  maxTotalTokens: number    // 整个会话总预算
  warningThreshold: number  // 预警阈值 (如 80%)
}
```

预算耗尽策略：
- 90% 时注入 nudge：「Token 预算即将耗尽，请继续完成任务，**不要总结**」（继续工作，不中断）
- 溢出时强制终止：保存状态，告知用户
- 关键：nudge 指令是「继续工作」而非「输出总结」——总结会让模型提前放弃任务

### 4. 错误恢复 ✅

- [ ] 工具执行失败时，错误信息回传给模型（而非直接崩溃）
- [ ] 模型可以根据错误信息调整策略
- [ ] 连续失败有计数器，超过阈值时终止或换策略

## 反模式

| 反模式 | 问题 | 正确做法 |
|--------|------|----------|
| 无限 while(true) 无上限 | Token 烧穿 | 加 maxTurns + maxTokens |
| 硬性 break 不给模型机会 | 任务中断 | 先 nudge，再强制 |
| 忽略 stop_reason | 截断当完成 | 区分 end_turn vs max_tokens |
| 错误直接 throw | 循环崩溃 | 错误回传给模型决策 |
| 只检测完全相同调用 | 漏检变体循环 | 用指纹 + 滑动窗口 |

## 评分标准

- ⭐⭐⭐⭐⭐：完整实现所有检查项，有 nudge 机制和优雅降级
- ⭐⭐⭐⭐：有终止条件和基本循环检测，缺少 nudge
- ⭐⭐⭐：有 maxTurns 但无死循环检测
- ⭐⭐：只有基本 while 循环，无保护
- ⭐：无终止条件，生产环境不可用
