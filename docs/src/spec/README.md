# Spec 系统

Spec（规格）是 Hank Agent 中描述项目能力的核心文档单元。每个 Spec 对应一个 `capability`（能力标识），记录该能力的完整技术规格。

## 核心概念

| 概念 | 说明 |
|------|------|
| Spec | 一个能力的完整规格文档，由 capability 唯一标识 |
| SpecVersion | Spec 的历史快照，记录每次变更前的状态 |
| Change | 一次变更请求，可包含多个 spec artifact |
| Checkpoint | 对话级别的状态快照，支持文件和 spec 的原子回退 |

## 生命周期

```
创建 Spec → Agent 对话中修改 → Checkpoint 自动记录
                                    ↓
                              可随时 Rewind 回退
                                    ↓
Change 归档 → LLM 智能合并到主 Spec → 新版本产生
```

## 设计原则

1. **非侵入式版本控制** — 利用 git orphan branch 存储 checkpoint，不污染用户的 commit 历史
2. **对话粒度回退** — 每轮用户消息前自动创建 checkpoint，回退时文件和 spec 状态一致恢复
3. **智能合并** — Change 归档时使用 LLM 将新内容与现有 spec 合并，避免内容堆砌
4. **容错降级** — Checkpoint 创建失败不阻塞对话，LLM 合并失败 fallback 到 append
