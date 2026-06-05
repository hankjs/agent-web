# Resilience 审查标准

## 核心原则

Agent 调用外部 API（LLM、工具服务），必须假设任何调用都可能失败。

## 审查 Checklist

### 1. 错误分类 ✅

```typescript
enum ErrorCategory {
  Transient = 'transient',     // 可重试：网络超时、429、503
  Permanent = 'permanent',     // 不可重试：400、401、模型拒绝
  Overloaded = 'overloaded',   // 过载：需要更长退避
}

function classify(error: Error): ErrorCategory {
  if (error.status === 429 || error.status === 503) return 'overloaded'
  if (error.status >= 500) return 'transient'
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') return 'transient'
  return 'permanent'
}
```

- [ ] 是否区分了可重试和不可重试错误？
- [ ] 429 是否有特殊处理（读取 Retry-After header）？
- [ ] 是否识别了网络层错误（DNS、连接重置）？

### 2. 重试策略 ✅

**指数退避 + 抖动（Exponential Backoff with Jitter）**

```typescript
function getRetryDelay(attempt: number, baseDelay = 1000): number {
  const exponential = baseDelay * Math.pow(2, attempt)
  const jitter = Math.random() * exponential * 0.5  // 50% 抖动
  return Math.min(exponential + jitter, 60000)       // 上限 60s
}
```

- [ ] 是否使用指数退避（而非固定间隔）？
- [ ] 是否有随机抖动（避免惊群效应）？
- [ ] 是否有最大重试次数（推荐 3-5 次）？
- [ ] 是否有最大退避时间上限？
- [ ] 重试是否只针对 transient 错误？

### 3. 超时管理 ✅

```typescript
interface TimeoutConfig {
  connectTimeout: number    // 连接超时 (5-10s)
  readTimeout: number       // 读取超时 (30-120s，LLM 响应慢)
  totalTimeout: number      // 总超时 (5-10min，含重试)
}
```

- [ ] LLM 调用是否有合理超时（考虑长输出）？
- [ ] 工具执行是否有独立超时？
- [ ] 超时后是否有 AbortController 清理？

### 4. 流式响应容错 ✅

流式（SSE/WebSocket）场景的特殊问题：

- [ ] 流中断是否能检测（心跳/超时）？
- [ ] 部分响应是否有缓存，支持断点续传？
- [ ] 流错误是否回退到非流式请求？

**"边说边执行"（Streaming Parallel Execution）**

生产级 Agent 不等整条消息说完再执行工具，工具块完成就立即开始：

- [ ] 只读工具（Read/Grep/Glob）是否在流式阶段并发执行？
- [ ] 写操作（Edit）是否等所有并发工具完成后才串行执行？
- [ ] Bash 工具失败是否级联取消同批次其他 Bash（不取消 Read）？
- [ ] 工具结果是否按调用顺序返回（而非完成顺序）？
- [ ] tool_use_id 是否正确匹配（协议层），结果顺序是否可调试？

**SSE vs WebSocket 选择**

| 场景 | 推荐 |
|------|------|
| LLM token 流式输出 | SSE（单向推送，标准 HTTP，自动重连）|
| 工具审批交互 | SSE + HTTP POST（两次流之间的空隙）|
| 高频双向实时 | WebSocket |

### 5. 降级策略 ✅

- [ ] 主模型不可用时是否有 fallback 模型？
- [ ] 工具执行失败是否将错误信息回传模型（让模型决策）？
- [ ] 连续失败是否有熔断机制（暂停调用一段时间）？

```typescript
// 错误回传模型，而非直接崩溃
if (toolError) {
  messages.push({
    role: 'tool',
    tool_use_id: id,
    content: `Error: ${toolError.message}. Please try a different approach.`,
    is_error: true
  })
}
```

### 6. 可观测性 ✅

- [ ] 是否记录了每次 API 调用的延迟和状态？
- [ ] 是否有重试次数的指标统计？
- [ ] 错误是否有结构化日志（含 request_id）？
- [ ] 是否能追踪单次 Agent 循环的完整调用链？

## 反模式

| 反模式 | 问题 | 正确做法 |
|--------|------|----------|
| 无重试 | 偶发网络错误即失败 | 指数退避重试 |
| 固定间隔重试 | 惊群效应 | 加随机抖动 |
| 重试所有错误 | 400 错误无限重试 | 分类后选择性重试 |
| 无超时 | 请求卡死 | 分层超时 |
| 错误直接 throw | Agent 循环崩溃 | 回传模型决策 |
| 无日志 | 出问题无法排查 | 结构化日志 |

## 评分标准

- ⭐⭐⭐⭐⭐：错误分类 + 指数退避 + 流容错 + 降级 + 可观测
- ⭐⭐⭐⭐：有重试和超时，缺流容错或降级
- ⭐⭐⭐：有基本重试，无错误分类
- ⭐⭐：只有 try-catch，无重试
- ⭐：错误直接崩溃，无任何容错
