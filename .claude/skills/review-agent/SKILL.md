---
name: review-agent
description: "Review Agent implementation code against production-grade patterns. Use when reviewing, auditing, or improving Agent systems: agent loops, tool systems, context engineering, compression, permission models, session persistence, error handling, and multi-agent coordination. Covers loop safety, tool registration/execution, context window management, token budgets, streaming, MCP integration, and harness engineering."
when_to_use: "Use when the user asks to review, audit, or improve an Agent implementation. Triggers on: /review-agent, 'review this agent', 'audit the loop', 'check my tool system', 'is this production-grade'."
user-invocable: true
---

# Review Agent Implementation

审查 Agent 实现代码，基于生产级 Agent 工程最佳实践提供改进建议。

## 审查维度

审查时按以下六大支柱逐一检查，加载对应 reference 获取详细标准：

| 支柱 | 关注点 | Reference |
|------|--------|-----------|
| Agent Loop | 循环结构、终止条件、死循环检测、Token 预算 | [agent-loop](references/agent-loop.md) |
| Tool System | 7 步执行管线、结果截断、并发控制、动态加载、错误信息设计 | [tool-system](references/tool-system.md) |
| Context Engineering | ORRIC 五维、JIT 三路线（Agentic Search/RAG/Offloading）、压缩策略、Cache | [context-engineering](references/context-engineering.md) |
| Permission & Safety | 四层防线、LLM 分类器、Mask Don't Remove、Prompt Injection | [permission-safety](references/permission-safety.md) |
| Session & Persistence | JSONL 存储、Prompt Pipe、Skills 渐进加载、Memory Flush、崩溃恢复 | [session-persistence](references/session-persistence.md) |
| Resilience | API 容错、重试策略、流式容错、"边说边执行"、降级处理 | [resilience](references/resilience.md) |

## 审查流程

1. **读取目标代码** — 先完整阅读待审查的 Agent 实现
2. **加载相关 reference** — 根据代码涉及的模块加载对应参考文档
3. **逐维度审查** — 对照 checklist 逐项检查
4. **输出审查报告** — 按严重程度分级：🔴 Critical / 🟡 Warning / 🟢 Suggestion

## 审查报告格式

```markdown
## Agent 实现审查报告

### 概要
- 审查范围：[文件/模块列表]
- 整体评级：[A/B/C/D]

### 🔴 Critical Issues
[必须修复的问题，可能导致死循环、Token 烧穿、安全漏洞]

### 🟡 Warnings
[建议修复，影响稳定性或性能]

### 🟢 Suggestions
[优化建议，提升代码质量和可维护性]

### 各维度评分
| 维度 | 评分 | 说明 |
|------|------|------|
| Agent Loop | ⭐⭐⭐⭐ | ... |
| Tool System | ⭐⭐⭐ | ... |
| ... | ... | ... |
```

## Quick Reference

### Agent Loop 核心检查项
- 是否有 maxTurns / maxTokens 硬性上限？
- 是否有死循环指纹检测（连续相同 tool_use 检测）？
- 终止条件是否明确（end_turn / stop_reason）？
- Token 预算耗尽时是否有 nudge 机制（90% 注入「继续工作，不要总结」指令）？

### Tool System 核心检查项
- 执行管线是否完整（参数校验→业务校验→标准化→Pre-Hook→权限→执行→Post-Hook）？
- 大结果是否有截断保护（head-tail 策略，50K chars 上限）？
- 错误信息是否面向模型（含纠错上下文）而非面向开发者（只有错误码）？
- 并发工具是否有读写锁控制（只读并发，写操作串行）？
- 工具数量 >15-30 时是否有 deferred loading？
- 工具列表是否在整个对话中保持稳定（Mask Don't Remove）？

### Context Engineering 核心检查项
- System Prompt 是否模块化（Prompt Pipe，静态前缀 + 动态后缀）？
- 是否有多层压缩策略（Microcompact → Summarize → Overflow Retry）？
- 是否利用了 Prompt Cache（静态前缀不变，动态内容追加到末尾）？
- JIT 路线是否匹配场景（代码→Agentic Search，知识库→RAG，长链路→Offloading）？
- 是否有 Context Rot 风险（上下文塞了大量无关内容稀释注意力）？

### Permission 核心检查项
- 破坏性操作是否需要确认？
- 是否有 allowlist/denylist + LLM 分类器两层判断？
- 路径操作是否有沙箱限制（防路径穿越）？
- 是否用 Mask 而非删除来禁用工具（保护 KV Cache）？
- 是否防止了 prompt injection 导致的越权？

### Session & Resilience 核心检查项
- 压缩前是否有 Memory Flush（避免信息永久丢失）？
- Skills 是否三层渐进加载（frontmatter → 完整内容 → 引用文件）？
- 是否有指数退避重试（区分 transient/permanent 错误）？
- 是否实现了"边说边执行"（工具块完成即执行，不等整条消息）？
