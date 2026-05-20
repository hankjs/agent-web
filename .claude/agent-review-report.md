# Hank Agent 实现审查报告

## 概要

- **审查范围**：`crates/hank-agent` 完整实现，包括 OrchestratorAgent、WorkerAgent、VerifierAgent、ContextManager、AgentSession
- **代码量**：~1100 行核心逻辑（Rust）
- **架构**：三层 Agent 系统（Orchestrator → Worker → Verifier）+ Context 管理 + Session 管理
- **整体评级**：**B+** （生产可用，但存在关键缺陷需修复）

---

## 🔴 Critical Issues

### 1. **Token 预算管理缺失**
**位置**：`orchestrator.rs:81`, `worker.rs:83`, `session.rs:169`

**问题**：
- ContextManager 有 80K token 阈值，但没有 **动态预算跟踪和耗尽提示**
- `compress_async()` 仅在达到阈值时触发，**无分层警告**（80% → 95% → 100%）
- 无 "Token 预算即将耗尽，请尽快总结" 的 nudge 消息
- 连续 MaxTokens 检测有 3 次上限，但无 Token 消耗速率告警

**影响**：
- 长对话中 Token 会突然耗尽，导致任务中断
- 模型无法提前准备总结，造成上下文断裂

**建议修复**：
```rust
// 在 ContextManager 中添加预算跟踪
pub struct TokenBudget {
    max_tokens: usize,
    warning_threshold: f32,  // 80%
    critical_threshold: f32, // 95%
}

// 在 agent loop 中定期检查
if estimated_tokens > total_budget * warning_threshold {
    event_tx.send(AgentEvent::TokenWarning {
        remaining: total_budget - estimated_tokens
    }).await;
}
```

---

### 2. **死循环检测完全缺失**
**位置**：整个 `orchestrator.rs` 和 `worker.rs`

**问题**：
- 代码只检查 `consecutive_max_tokens >= 3`，这是 **MaxTokens 连续次数**，不是 **死循环检测**
- 无法检测：
  - 模型重复调用相同工具（不同参数）
  - 工具调用序列的周期性重复
  - 模型在两个状态间摇摆

**示例场景**（会卡死）：
```
Iteration 1: call tool_A with {query: "foo"}
Iteration 2: call tool_B
Iteration 3: call tool_A with {query: "bar"}
Iteration 4: call tool_B
Iteration 5: ... 永无止境的 A→B 循环
```

**建议修复**：
```rust
struct LoopDetector {
    window: Vec<String>,  // 最近 N 次的 tool 指纹
    window_size: usize,   // 推荐 5-10
}

impl LoopDetector {
    fn fingerprint(tool_name: &str, input: &serde_json::Value) -> String {
        // tool_name + hash(input) 简单版本
        format!("{}:{:x}", tool_name, md5(input.to_string()))
    }

    fn detect_cycle(&mut self, fingerprint: String) -> bool {
        self.window.push(fingerprint.clone());
        if self.window.len() > self.window_size {
            self.window.remove(0);
        }
        // 检查滑动窗口内重复率 > 70%
        let unique = self.window.iter().collect::<HashSet<_>>().len();
        unique as f32 / self.window.len() as f32 < 0.3
    }
}
```

**影响**：高危，生产环境会导致 Agent 长时间卡死，烧穿 Token 预算

---

### 3. **上下文压缩触发时机不当**
**位置**：`orchestrator.rs:126-128`

**问题**：
```rust
if self.context_manager.needs_compression(&self.messages) {
    self.context_manager.compress_async(&mut self.messages).await;
}
```

- 仅在进入循环时检查压缩，**不是在消息追加后实时检查**
- 如果单次 LLM 输出巨大（接近上下文窗口），不会触发压缩
- `compress_async()` 调用后没有检查是否成功，失败时无 fallback

**建议修复**：
```rust
// 在追加消息后立即检查
self.messages.push(assistant_msg);
if self.context_manager.needs_compression(&self.messages) {
    match self.context_manager.compress_async(&mut self.messages).await {
        Ok(_) => debug!("Context compressed"),
        Err(e) => {
            warn!("Compression failed: {}, falling back to truncate", e);
            // truncate 最早的消息
        }
    }
}
```

---

### 4. **错误处理不一致**
**位置**：多处

**问题**：
- `orchestrator.rs:223` 工具执行错误标记为 `is_error: true`，但错误信息可能被截断或丢失
- `worker.rs:152-157` 流错误直接返回 Failed 状态，没有尝试恢复
- `session.rs:244-251` 流错误导致整个 Agent 循环崩溃（`return Err(e)`）

**建议**：
- 工具错误应回传给 LLM 决策（而非直接标记为失败）
- 流错误应有重试机制
- 本地处理不了的错误才向上层抛出

```rust
// 工具错误回传给模型
tool_results.push(ContentBlock::ToolResult {
    tool_use_id: id.clone(),
    content: if output.is_error {
        format!("Error: {}. Please try a different approach.", output.content)
    } else {
        output.content
    },
    is_error: output.is_error,
});
```

---

## 🟡 Warnings

### 1. **缺少超时保护**
**位置**：`session.rs:175`, `orchestrator.rs:208`, `worker.rs:97`

**问题**：
- LLM stream 没有明确的超时（只有 `cancel` token）
- 工具执行无超时限制
- 长流应该有心跳检测

**影响**：工具卡死会导致整个 Agent 无响应

**建议**：
```rust
const STREAM_TIMEOUT: Duration = Duration::from_secs(120);

let event = tokio::select! {
    event = stream.next() => event,
    _ = cancel.cancelled() => None,
    _ = tokio::time::sleep(STREAM_TIMEOUT) => {
        return Err(anyhow!("Stream timeout"));
    }
};
```

---

### 2. **ContextManager 压缩策略不完整**
**位置**：`context/manager.rs`

**问题**：
- 只有一层压缩（摘要替换）
- 缺少 **三层递进策略**：
  1. Microcompact：清除旧 tool_result 具体内容（无损）
  2. Summarization：LLM 摘要（中等成本）
  3. Overflow Retry：截断最旧消息（激进）

- 当前压缩保留 6 条消息（hardcoded），无配置化
- 压缩后没有验证是否真正降低了 token 使用

**建议**：实现多层压缩，参考 context-engineering.md

---

### 3. **Worker 工具过滤不够严格**
**位置**：`orchestrator.rs:483-488`

**问题**：
```rust
let worker_tools: Vec<Arc<dyn Tool>> = self
    .tools
    .iter()
    .filter(|t| task.tools_allowed.contains(&t.name().to_string()))
    .cloned()
    .collect();
```

- 仅按名称过滤，没有 **权限验证**
- 没有检查 `affected_paths` 是否与工具的操作范围冲突
- 没有检查工具的破坏性级别

**建议**：
```rust
// 添加工具风险检查
fn validate_tool_permission(
    tool: &Arc<dyn Tool>,
    affected_paths: &[String],
) -> Result<()> {
    let risk = get_tool_risk(tool.name());
    match risk {
        ToolRisk::Dangerous => {
            // 需要显式授权
            Err(anyhow!("Tool {} is dangerous, requires explicit approval", tool.name()))
        }
        _ => Ok(())
    }
}
```

---

### 4. **Verifier 可靠性不高**
**位置**：`agent/verifier.rs:183-233`

**问题**：
- JSON 解析有两层 fallback，最后默认返回 `Approved`
- 这意味着任何无效 JSON 都被当作"已批准"，**降低了验证的价值**
- 没有对 verdict 的有效性进行 double-check

**建议**：
```rust
fn parse_verification(&self, text: &str) -> VerificationResult {
    // ... 尝试解析 ...

    // 最后的 fallback：返回 NeedsRevision 而不是 Approved
    // 这样更谨慎，不确定时要求修订
    VerificationResult {
        verdict: Verdict::NeedsRevision,
        issues: vec!["Could not parse verification result".to_string()],
    }
}
```

---

### 5. **缺少会话持久化**
**位置**：`session.rs`

**问题**：
- AgentSession 完全在内存中，无持久化
- 中断后无法恢复（可通过 `set_messages()` 手动恢复，但很脆弱）
- 无会话生命周期管理（超时、归档等）

**建议**：
- 实现 append-only JSONL 存储（参考 session-persistence.md）
- 在服务层（server/src）实现会话持久化

---

### 6. **系统 Prompt 未模块化**
**位置**：`orchestrator.rs:188-191`, `worker.rs:54-60`, `verifier.rs:51-54`

**问题**：
- 每个 Agent 都有硬编码的 system prompt
- 修改需要改多处代码
- 无法利用 Prompt Cache 优化

**建议**：
- 实现 Prompt Pipe 模式（参考 context-engineering.md）
- 将 prompt 分为静态和动态部分

```rust
type PromptPipe = fn(&str) -> String;

fn base_prompt() -> String { "You are a helpful assistant..." }
fn tool_instructions(tools: &[&str]) -> String { ... }

fn build_system_prompt(mode: &str) -> String {
    vec![base_prompt(), tool_instructions(&[...])].join("\n\n")
}
```

---

## 🟢 Suggestions

### 1. **完善事件系统**

当前 AgentEvent 很全面，但建议添加：
- `TokenUsageAlert` - 预警事件
- `LoopDetected` - 循环检测事件
- `CompressionTriggered` - 压缩触发事件
- `RetryAttempt` - 重试事件

---

### 2. **LLM 请求频率控制**

代码中 `LlmRequest` 事件记录了每次请求，但没有：
- 流量限流（rate limiting）
- 请求合并（当多个子任务调用同一模型）
- 本地缓存（相同查询避免重复调用）

**建议**：在 session.rs 上层添加 RateLimiter

---

### 3. **可观测性增强**

当前有基本的 metrics，建议添加：
- Trace ID（追踪整条链路）
- Structured logging（JSON 格式）
- 分阶段的时间分解（think_time, act_time, observe_time）

```rust
pub struct AgentMetrics {
    session_id: String,
    trace_id: String,
    phase: String,
    start_time: Instant,
    end_time: Instant,
    tokens_used: u32,
    tool_calls: usize,
}
```

---

### 4. **权限系统设计**

虽然 hank-web-tools 可能有权限控制，但 Agent 层建议：
- 定义工具风险等级枚举
- 支持 allowlist/denylist 规则
- 记录所有工具调用审计日志

---

### 5. **graceful shutdown**

当前的 `CancellationToken` 使用很好，但建议添加：
- Shutdown timeout（强制等待一段时间后直接退出）
- 保存状态（shutdown 时自动压缩+持久化）

```rust
pub async fn shutdown(&mut self, timeout: Duration) -> Result<()> {
    self.cancel.cancel();
    tokio::select! {
        _ = self.wait_completion() => Ok(()),
        _ = tokio::time::sleep(timeout) => {
            warn!("Shutdown timeout, forcing termination");
            self.save_state().await?;
            Ok(())
        }
    }
}
```

---

### 6. **模型 Fallback 机制**

OrchestratorAgent 创建时固定一个模型，建议添加：
- 主模型不可用时自动切换备用模型
- 特定错误时尝试不同模型（如模型拒绝调用某工具）

---

## 各维度评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **Agent Loop** | ⭐⭐⭐ | 有 maxTurns 和基本 maxTokens，但缺 nudge、无死循环检测 |
| **Tool System** | ⭐⭐⭐⭐ | 工具执行、错误处理都不错，缺权限分层 |
| **Context Engineering** | ⭐⭐⭐ | 有基本压缩，但缺多层策略、缺 Prompt Pipe、缺 JIT |
| **Permission & Safety** | ⭐⭐ | 工具过滤不严格，无权限规则、无审计日志 |
| **Session & Persistence** | ⭐ | 完全内存存储，无持久化机制 |
| **Resilience** | ⭐⭐⭐ | 有基本重试（MaxTokens），缺超时、缺流容错、缺降级 |

---

## 优点总结 ✅

1. **架构清晰**：三层 Agent 系统（Orchestrator-Worker-Verifier）分工合理
2. **流处理完善**：Stream 事件处理细致，支持 TextDelta、ToolUse 等
3. **Cancel 机制**：使用 CancellationToken 优雅处理中断
4. **事件驱动**：丰富的 AgentEvent 类型便于前端实时反馈
5. **工具生命周期**：工具的注册、执行、错误处理流程完整
6. **灵活的 Agent 模式**：支持 Simple 和 Orchestrated 两种模式

---

## 修复优先级

### P0（必须修复）
1. ✅ 实现真正的死循环检测（指纹 + 滑动窗口）
2. ✅ 添加分层 Token 预算警告机制
3. ✅ 改进压缩触发时机和失败处理

### P1（应该修复）
4. ✅ 添加超时保护（Stream 和工具）
5. ✅ 实现会话持久化（至少 JSONL 格式）
6. ✅ 工具权限系统

### P2（可以优化）
7. ✅ Prompt Pipe 模块化
8. ✅ 可观测性增强（Trace ID、structured logging）
9. ✅ 模型 Fallback 机制

---

## 结论

hank-agent 实现**架构合理，基础扎实**，但在**生产可靠性**方面还有明显缺陷：

- **高风险**：无死循环检测、Token 预算管理不完整
- **中风险**：缺超时保护、会话无持久化、权限不严格
- **低风险**：缺可观测性、系统 Prompt 未模块化

**建议**：在推送到生产前，**必须完成 P0 项目**（特别是死循环检测和 Token 预算）。修复后评级可提升至 **A-**。

---

## 附录：快速改进清单

### 一周内可完成（P0）
- [ ] 实现 LoopDetector 并集成到 orchestrator/worker
- [ ] 添加 TokenWarning 事件和 nudge 消息
- [ ] 修复压缩失败处理

### 两周内可完成（P1）
- [ ] 添加流超时和工具超时
- [ ] 实现 append-only JSONL 会话存储
- [ ] 添加工具风险分类和权限检查

### 一个月内可完成（P2）
- [ ] Prompt Pipe 模块化重构
- [ ] Trace ID + structured logging
- [ ] 模型 Fallback 和降级策略

