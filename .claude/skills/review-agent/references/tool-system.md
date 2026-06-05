# Tool System 审查标准

## 工具生命周期

```
定义 → 注册 → 发现 → 选择 → 参数校验 → 业务校验 → 输入标准化 → Pre-Hook → 权限检查 → 执行 → 结果处理 → Post-Hook → 回传
```

### 完整 7 步执行管线（Claude Code 模式）

1. **参数格式校验**：JSON Schema 验证，失败返回精确路径（"file_path: Expected string, received number"）
2. **业务逻辑校验**：语义层检查（文件是否存在、old_string 是否唯一）
3. **输入标准化**：生成补全副本（相对路径→绝对路径），保留原始输入不变以维持 Prompt Cache
4. **Pre-Hook**：用户自定义脚本，exit 0 放行，exit 2 拦截，输出 updatedInput 修改后放行
5. **权限检查**：规则匹配 → LLM 分类器（语义层判断 git status vs git push --force）→ 交互确认
6. **执行 + 结果处理**：工具执行，大结果存磁盘，错误信息面向模型设计（含纠错上下文）
7. **Post-Hook**：过滤敏感信息、触发 lint、审计日志

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
- [ ] **批量预算**：单次 LLM 请求内所有工具结果总量有上限（单条截断了，批次总量也可能爆）
- [ ] 超阈值大结果是否落盘并在上下文里放路径 + 摘要（而非直接截断塞入上下文）

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

工具数量阈值：超过延迟工具总 Schema 的 10% 上下文窗口（约 25-30 个工具）时触发。

**三种策略对比**

| 策略 | 核心思路 | Cache 影响 | 需要 API 支持 |
|------|----------|-----------|--------------|
| Claude Code Deferred Loading | ToolSearch 按需发现，API 层 defer_loading | 极低（defer 工具不参与 Cache key）| 是 |
| OpenClaw Tool Profile | 按场景预选工具子集 | 切换 Profile 会失效 | 否 |
| Manus 小工具集 + Bash | <20 原子工具，复杂操作 bash/脚本 | 极低（列表永远不变）| 是（logit masking）|

**无 Anthropic API 时的两种备选方案**

方案 A：ToolSearch 返回文本 Schema + 动态添加 tools 列表（加工具那轮 Cache 失效，之后稳定）

方案 B：双工具代理（Cache 完全不受影响）
```json
// tools 列表永远只有这两个，不变
[
  { "name": "tool_search", "description": "搜索可用工具，返回完整 Schema" },
  { "name": "call_tool", "description": "调用工具，参数参考 tool_search 结果" }
]
```

**关键原则：工具列表稳定性 > 工具数量少**
宁可保留用不上的工具，也不要在每轮动态增删（Cache 杀手）。

- [ ] 工具数量是否超阈值（>15-30）？是否有延迟加载或分组策略？
- [ ] 每个延迟工具是否有 `searchHint`（3-10 词，供 ToolSearch 匹配）？
- [ ] 工具列表在整个对话中是否保持稳定（"Mask Don't Remove"）？
- [ ] 禁用工具是否用 mask 而非删除？

### 7. 错误信息设计（面向模型）✅

错误信息接收者是模型，不是开发者：

- [ ] 错误是否包含纠错所需的上下文（而非只有错误码）？
- [ ] 文件不存在时是否列出当前目录的可选文件？
- [ ] old_string 不唯一时是否说明出现次数并建议提供更多上下文？

```
❌ ENOENT: no such file or directory, open '/src/helpers/utils.ts'
✅ 文件 /src/helpers/utils.ts 不存在。当前 /src/ 目录下有：
   - /src/utils.ts
   - /src/lib/helpers.ts
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
| 动态增删工具列表 | Cache 全部失效 | Mask Don't Remove |
| 错误信息面向开发者 | 模型无法自我纠正 | 包含纠错上下文 |
| 保留原始输入做补全 | Cache miss | 生成副本，保留原始 |

## 评分标准

- ⭐⭐⭐⭐⭐：完整管线 + 截断 + 并发控制 + 动态加载
- ⭐⭐⭐⭐：有截断和错误处理，缺动态加载
- ⭐⭐⭐：基本注册和执行，有超时保护
- ⭐⭐：能跑但无截断、无并发控制
- ⭐：工具定义不规范，无错误处理
