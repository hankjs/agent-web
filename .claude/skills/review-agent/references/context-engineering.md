# Context Engineering 审查标准

## 五维模型：ORRIC

| 维度 | 含义 | 手段 |
|------|------|------|
| **O**ffload | 卸载 | 把用过的信息写到文件系统，只留路径（无损，可恢复）|
| **R**educe | 缩减 | 压缩已有上下文（有损，慎用）|
| **R**etrieve | 检索 | 按需拉取相关信息（JIT）|
| **I**solate | 隔离 | 子任务用独立上下文（Multi-Agent）|
| **C**ache | 缓存 | 复用已计算的 KV Cache |

**优先级**：原始内容 > Offload（无损）> Compress（有损）> Summary（摘要）

## 审查 Checklist

### 1. System Prompt 工程化（Prompt Pipe）✅

模块化组装，而非一个巨大字符串：

```typescript
// Prompt Pipe 模式
type PromptPipe = (context: RuntimeContext) => string | null

const pipes: PromptPipe[] = [
  baseIdentityPipe,      // 始终加载：身份和基本规则
  toolInstructionsPipe,  // 始终加载：工具使用说明
  projectContextPipe,    // 条件加载：项目相关上下文
  memoryPipe,            // 条件加载：记忆文件
  skillPipe,             // 按需加载：当前激活的 skill
]

function buildSystemPrompt(ctx: RuntimeContext): string {
  return pipes.map(p => p(ctx)).filter(Boolean).join('\n\n')
}
```

- [ ] System Prompt 是否模块化？
- [ ] 静态部分是否放在最前面（利于 Cache）？
- [ ] 动态部分是否按需加载？
- [ ] 是否避免了 Context Rot（过时信息污染）？

### 2. 上下文压缩策略 ✅

推荐分层压缩，从轻到重，能用简单手段解决的绝不上复杂方案：

**即时防线（零 LLM 成本，每轮自动执行）**
- 工具结果截断：单条超过窗口 50% 时做 Head/Tail 60/40 分割；总量超 75% 时从最旧开始清理
- TTL 修剪：软修剪（5 分钟）保留头尾替换中间；硬清除（10 分钟）清空内容只留标记
- 注意：错误结果永不修剪（模型需要记住「这条路走不通」）

**Layer 1: Microcompact（无损清理，无 LLM 调用）**
- 清除旧 tool_result 的具体内容，保留消息结构和角色顺序
- 只清理「查询类」工具结果（read_file、bash、grep 等），保留最近 N 条不动

```typescript
function microcompact(messages: Message[]): Message[] {
  return messages.map((msg, i) => {
    if (i < messages.length - 4 && msg.role === 'tool') {
      return { ...msg, content: '[result cleared]' }
    }
    return msg
  })
}
```

**Layer 2: Summarization（LLM 摘要，有 LLM 成本）**
- 用小模型对历史消息生成结构化摘要（模板化，不要让模型自由发挥）
- 保留关键标识符（文件路径、函数名、UUID），切分点对齐到 user 消息边界
- 已有摘要时合并进去一起压缩（累积摘要，不丢失最早期信息）
- 失败时返回原始消息列表，不能影响 Agent 正常工作

**执行顺序**：即时防线（截断 + TTL）→ Microcompact → Summarization（按需）

- [ ] 是否有压缩触发阈值（如 75-87% 上下文窗口）？
- [ ] 压缩是否保留了关键信息（文件路径、决策点）？
- [ ] 是否有多层递进策略（先无损后有损）？
- [ ] 压缩失败是否有 fallback？
- [ ] 是否用小模型而非主力模型做摘要（降成本）？

### 3. Just-In-Time Context ✅

**三条 JIT 路线对比**

| 路线 | 核心机制 | 适合场景 |
|------|----------|----------|
| Agentic Search | Agent 用 Glob/Grep/Read 主动探索 | 代码导航、内容频繁变化（Claude Code/Cursor/Devin 的选择）|
| RAG | 预建索引，语义检索 top-k | 知识库问答、非结构化文档、延迟敏感 |
| Context Offloading (Manus) | 用过的信息写到文件，上下文只留路径 | 长链路任务（50+ 轮工具调用）|

**为什么 Coding Agent 选 Agentic Search 而非 RAG**：
- Grep 是精确匹配，向量检索是模糊匹配
- 代码随时在变，RAG 索引容易过期
- Agentic Search 过程可观测（每步可看）
- 零额外基础设施（文件系统即数据库）

**Hybrid Retrieval Strategy（Anthropic 推荐）**：
```
确定性最高 → 预加载到 system prompt（CLAUDE.md、用户偏好）
确定性中等 → 按规则触发（*.test.ts 打开时加载测试规范）
确定性最低 → 交给 Agent Agentic Search/RAG 自主发现
```

- [ ] 是否避免了预加载大量静态内容？
- [ ] 是否提供了足够的搜索/检索工具（Glob/Grep/Read）？
- [ ] CLAUDE.md / 项目说明是否精简（< 200 行）？
- [ ] 大结果是否先 Offload 到文件再在上下文里放路径？

### 4. Cache 利用 ✅

Prompt Cache 原理：相同前缀的 token 序列可复用 KV Cache

- [ ] System Prompt 静态部分是否放在最前面？
- [ ] 是否避免了在 system prompt 中间插入动态内容？
- [ ] 工具定义顺序是否稳定（不随请求变化）？
- [ ] 是否了解 Cache 失效条件（前缀变化即失效）？

### 5. 子 Agent 隔离 ✅

复杂任务拆分给子 Agent，避免主上下文膨胀：

```typescript
// 主 Agent 委托子任务
const result = await subAgent.run({
  task: "搜索项目中所有 API 端点并列出",
  tools: [grep, glob, read_file],
  maxTurns: 10
})
// 只将摘要结果注入主上下文
messages.push({ role: 'user', content: `子任务结果：${result.summary}` })
```

- [ ] 大范围搜索/分析是否委托给子 Agent？
- [ ] 子 Agent 结果是否经过摘要再注入？
- [ ] 子 Agent 是否有独立的 token 预算？

## 反模式

| 反模式 | 问题 | 正确做法 |
|--------|------|----------|
| 巨型 system prompt | Token 浪费 + Cache 失效 | Prompt Pipe 模块化 |
| 预加载所有文件 | 上下文爆炸 | JIT 按需加载 |
| 无压缩策略 | 长对话必崩 | 三层递进压缩 |
| 动态内容插在 prompt 中间 | Cache 命中率低 | 静态前缀 + 动态后缀 |
| 子任务结果全量注入 | 主上下文膨胀 | 摘要后注入 |

## 评分标准

- ⭐⭐⭐⭐⭐：Prompt Pipe + 三层压缩 + JIT + Cache 优化 + 子 Agent 隔离
- ⭐⭐⭐⭐：有压缩和 JIT，缺 Cache 优化
- ⭐⭐⭐：有基本压缩，system prompt 模块化
- ⭐⭐：无压缩，但 prompt 不算太大
- ⭐：巨型 prompt + 无压缩 + 预加载一切
