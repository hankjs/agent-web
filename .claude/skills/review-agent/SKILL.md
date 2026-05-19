---
name: review-agent
description: "Review Agent implementation code against production-grade patterns. Use when reviewing, auditing, or improving Agent systems: agent loops, tool systems, context engineering, compression, permission models, session persistence, error handling, and multi-agent coordination. Covers loop safety, tool registration/execution, context window management, token budgets, streaming, MCP integration, and harness engineering."
user-invocable: true
---

# Review Agent Implementation

审查 Agent 实现代码，基于生产级 Agent 工程最佳实践提供改进建议。

## 审查维度

审查时按以下六大支柱逐一检查，加载对应 reference 获取详细标准：

| 支柱 | 关注点 | Reference |
|------|--------|-----------|
| Agent Loop | 循环结构、终止条件、死循环检测、Token 预算 | [agent-loop](references/agent-loop.md) |
| Tool System | 工具注册、执行管线、结果截断、并发控制、动态加载 | [tool-system](references/tool-system.md) |
| Context Engineering | 上下文组装、压缩策略、JIT 加载、Cache 利用 | [context-engineering](references/context-engineering.md) |
| Permission & Safety | 权限分层、输入校验、破坏性操作防护 | [permission-safety](references/permission-safety.md) |
| Session & Persistence | 会话存储、Prompt Pipe 模式、崩溃恢复 | [session-persistence](references/session-persistence.md) |
| Resilience | API 容错、重试策略、错误分类、降级处理 | [resilience](references/resilience.md) |

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
- Token 预算耗尽时是否有 nudge 机制？

### Tool System 核心检查项
- 工具描述是否清晰、无歧义？
- 大结果是否有截断保护（head-tail 策略）？
- 并发工具是否有读写锁控制？
- 工具数量 >15 时是否有 deferred loading？

### Context Engineering 核心检查项
- System Prompt 是否模块化（Prompt Pipe）？
- 是否有多层压缩策略（Microcompact → Summarize）？
- 是否利用了 Prompt Cache（静态前缀）？
- JIT Context 是否按需加载而非预加载？

### Permission 核心检查项
- 破坏性操作是否需要确认？
- 是否有 allowlist/denylist 机制？
- 路径操作是否有沙箱限制？
- 是否防止了 prompt injection 导致的越权？
