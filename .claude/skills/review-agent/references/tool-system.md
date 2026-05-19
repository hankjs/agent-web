# Tool System 审查标准

## 工具生命周期

```
定义 → 注册 → 发现 → 选择 → 参数校验 → 执行 → 结果处理 → 回传
```

## 审查 Checklist

### 1. 工具定义质量 ✅

- [ ] name：动词开头，snake_case，无歧义（`read_file` 而非 `file`）
- [ ] description：说明「什么时候用」而非「是什么」
- [ ] inputSchema：JSON Schema 完整，必填/选填明确
- [ ] 避免工具语义重叠（如同时有 `search` 和 `find`）

```typescript
// 好的工具描述
description: "Read the contents of a file. Use when you need to examine existing code before making changes."

// 差的工具描述
description: "File reader tool"
```

### 2. 工具注册与管理 ✅

```typescript
interface ToolRegistry {
  register(tool: ToolDefinition): void
  get(name: string): ToolDefinition | undefined
  list(): ToolDefinition[]
  getSchema(): ToolSchema[]  // 供 LLM 使用的 schema
}
```

元数据标注：
- `isReadOnly`: 是否只读（影响并发策略）
- `isConcurrencySafe`: 是否可并发执行
- `maxResultChars`: 结果最大字符数
- `timeout`: 执行超时时间

### 3. 执行管线 ✅

完整的工具执行管线（参考 Claude Code）：

```
参数校验 → 业务校验 → 输入规范化 → Pre-hook → 权限检查 → 执行 → 结果处理 → Post-hook
```

- [ ] 参数类型校验（JSON Schema validation）
- [ ] 业务逻辑校验（如文件路径是否在允许范围内）
- [ ] 执行超时保护
- [ ] 错误捕获并格式化为 tool_result 回传

### 4. 结果截断 ✅

大结果会撑爆上下文，必须截断：

```typescript
function truncateResult(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content
  const headRatio = 0.6  // 头部保留 60%
  const tailRatio = 0.4  // 尾部保留 40%
  const head = content.slice(0, maxChars * headRatio)
  const tail = content.slice(-(maxChars * tailRatio))
  return `${head}\n\n... [truncated ${content.length - maxChars} chars] ...\n\n${tail}`
}
```

- [ ] 默认最大结果长度（推荐 30K-50K chars）
- [ ] Head-tail 截断策略（60/40 或 70/30）
- [ ] 截断提示包含原始长度信息
- [ ] 特殊工具可自定义截断策略

### 5. 并发控制 ✅

模型可能一次返回多个 tool_use：

- [ ] 只读工具可并发执行（`Promise.all`）
- [ ] 写操作串行执行或加锁
- [ ] 混合场景：读写锁（RwLock）模式

```typescript
// 并发执行策略
if (toolCalls.every(t => registry.get(t.name)?.isReadOnly)) {
  results = await Promise.all(toolCalls.map(execute))
} else {
  results = await executeSequentially(toolCalls)
}
```

### 6. 动态工具集（Deferred Loading）✅

当工具数量 > 15 时，全部塞入 prompt 会：
- 消耗大量 token
- 降低模型选择准确率
- 破坏 KV Cache

解决方案：

```typescript
// 分层策略
const alwaysLoaded = ['read_file', 'write_file', 'bash', 'grep']  // 高频核心工具
const deferredTools = [...]  // 低频工具，通过 tool_search 发现

// tool_search 元工具
{
  name: 'tool_search',
  description: 'Search for available tools by keyword when you need a capability not in your current toolset',
  execute: (query) => fuzzyMatch(deferredTools, query)
}
```

## 反模式

| 反模式 | 问题 | 正确做法 |
|--------|------|----------|
| 无截断保护 | 一个 `cat` 大文件撑爆上下文 | 强制截断 + 提示 |
| 所有工具全量加载 | Token 浪费 + 选择不准 | Deferred Loading |
| 工具描述模糊 | 模型选错工具 | 说明使用场景 |
| 错误直接 throw | Agent 循环崩溃 | 格式化为 tool_result |
| 无超时 | 工具卡死阻塞循环 | 加 timeout + AbortController |
| 并发写操作 | 竞态条件 | 读写锁 |

## 评分标准

- ⭐⭐⭐⭐⭐：完整管线 + 截断 + 并发控制 + 动态加载
- ⭐⭐⭐⭐：有截断和错误处理，缺动态加载
- ⭐⭐⭐：基本注册和执行，有超时保护
- ⭐⭐：能跑但无截断、无并发控制
- ⭐：工具定义不规范，无错误处理
