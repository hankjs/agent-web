# Agent Architecture Patterns — Deep Reference

## Agent Loop 详细实现

### 完整 Agent Loop（含所有防护层）

```typescript
import { generateText, streamText, type LanguageModel } from 'ai';

interface AgentConfig {
  model: LanguageModel;
  system: string;
  tools: ToolRegistry;
  maxSteps: number;          // 最大循环次数，默认 30
  budgetTokens: number;      // Token 预算，默认 200_000
  loopThreshold: number;     // 连续重复调用阈值，默认 3
  maxRetries: number;        // API 重试次数，默认 3
  onStep?: (step: StepInfo) => void;
}

interface StepInfo {
  step: number;
  toolCalls: { name: string; args: unknown }[];
  tokenUsage: { input: number; output: number; total: number };
  budgetRemaining: number;
}

// PLACEHOLDER_CONTINUE_1
```

### Loop Detection 实现

```typescript
class LoopDetector {
  private history: string[] = [];
  private threshold: number;

  constructor(threshold = 3) {
    this.threshold = threshold;
  }

  record(toolName: string, args: unknown): void {
    this.history.push(JSON.stringify({ toolName, args }));
  }

  isLooping(): boolean {
    if (this.history.length < this.threshold) return false;
    const recent = this.history.slice(-this.threshold);
    return recent.every(call => call === recent[0]);
  }

  getNudgeMessage(): string {
    return '检测到重复操作。请尝试不同的方法或参数来解决当前问题，而不是重复相同的操作。';
  }

  reset(): void {
    this.history = [];
  }
}
```

### API 容错 — 指数退避重试

```typescript
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;      // ms
  maxDelay: number;       // ms
  retryableStatuses: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  retryableStatuses: [429, 500, 502, 503, 504],
};

async function withRetry<T>(
  fn: () => Promise<T>,
  config = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      const status = error?.status ?? error?.response?.status;
      const isRetryable = config.retryableStatuses.includes(status)
        || error.code === 'ECONNRESET'
        || error.code === 'ETIMEDOUT';

      if (!isRetryable || attempt === config.maxRetries) throw error;

      // 指数退避 + 随机抖动
      const delay = Math.min(
        config.baseDelay * Math.pow(2, attempt) + Math.random() * 500,
        config.maxDelay
      );

      // 429 时优先使用 Retry-After header
      if (status === 429 && error.headers?.['retry-after']) {
        const retryAfter = parseInt(error.headers['retry-after']) * 1000;
        await sleep(retryAfter);
      } else {
        await sleep(delay);
      }
    }
  }
  throw lastError!;
}
```

### Token Budget 追踪

```typescript
interface BudgetState {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  budget: number;
  remaining: number;
  exhausted: boolean;
}

class TokenBudget {
  private inputTokens = 0;
  private outputTokens = 0;
  private budget: number;

  constructor(budget: number) {
    this.budget = budget;
  }

  record(usage: { promptTokens: number; completionTokens: number }) {
    this.inputTokens += usage.promptTokens;
    this.outputTokens += usage.completionTokens;
  }

  get state(): BudgetState {
    const total = this.inputTokens + this.outputTokens;
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: total,
      budget: this.budget,
      remaining: this.budget - total,
      exhausted: total >= this.budget,
    };
  }
}
```

## Tool 实现参考

### edit_file — 精确替换

核心逻辑：old_string 必须在文件中唯一匹配，否则报错要求提供更多上下文。

```typescript
execute: async ({ path, old_string, new_string }) => {
  const content = readFileSync(resolve(path), 'utf-8');
  const count = content.split(old_string).length - 1;

  if (count === 0) return '未找到匹配内容，请检查 old_string 是否精确';
  if (count > 1) return `找到 ${count} 处匹配，请提供更多上下文让 old_string 唯一`;

  writeFileSync(resolve(path), content.replace(old_string, new_string));
  return '文件已更新';
}
```

### bash — 带超时和输出截断

```typescript
execute: async ({ command, timeout = 30000 }) => {
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout,
      maxBuffer: 1024 * 1024, // 1MB
      cwd: process.cwd(),
    });
    const output = (stdout + (stderr ? `\nSTDERR:\n${stderr}` : '')).trim();
    return truncate(output, 10000);
  } catch (e: any) {
    if (e.killed) return `命令超时 (${timeout}ms)`;
    return `Exit ${e.code}: ${truncate(e.stderr || e.message, 5000)}`;
  }
}
```

### grep — 内容搜索

```typescript
execute: async ({ pattern, path = '.', include }) => {
  const args = ['-rn', '--color=never'];
  if (include) args.push(`--include=${include}`);
  args.push(pattern, path);

  const { stdout } = await execAsync(`grep ${args.join(' ')}`, { maxBuffer: 1024 * 1024 });
  const lines = stdout.trim().split('\n');
  if (lines.length > 50) {
    return lines.slice(0, 50).join('\n') + `\n...[${lines.length - 50} more matches]`;
  }
  return stdout.trim() || '无匹配结果';
}
```

## Context Compression 策略

### Microcompact 压缩

对旧消息进行摘要压缩，保留最近 N 条完整消息：

```typescript
async function compressMessages(
  messages: Message[],
  model: LanguageModel,
  keepRecent = 4
): Promise<Message[]> {
  if (messages.length <= keepRecent + 2) return messages;

  const toCompress = messages.slice(0, -keepRecent);
  const toKeep = messages.slice(-keepRecent);

  const summary = await generateText({
    model,
    system: `将以下对话压缩为简洁摘要。保留：
- 关键决策和结论
- 文件路径和代码位置
- 用户的明确要求
- 工具调用的重要结果
删除：重复内容、中间推理过程、失败的尝试细节`,
    messages: [{ role: 'user', content: formatForSummary(toCompress) }],
  });

  return [
    { role: 'user', content: `[对话历史摘要]\n${summary.text}` },
    { role: 'assistant', content: '好的，我已了解之前的对话内容，请继续。' },
    ...toKeep,
  ];
}
```

### 触发时机

- 当 token 使用量超过上下文窗口的 80% 时触发
- 或当消息数超过阈值（如 20 条）时触发

## System Prompt 工程化

### 结构化 System Prompt 模板

```typescript
function buildSystemPrompt(params: {
  role: string;
  capabilities: string[];
  tools: ToolDefinition[];
  constraints: string[];
  context?: string;
}): string {
  return `# Role
${params.role}

# Capabilities
${params.capabilities.map(c => `- ${c}`).join('\n')}

# Available Tools
${params.tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

# Constraints
${params.constraints.map(c => `- ${c}`).join('\n')}

${params.context ? `# Context\n${params.context}` : ''}`;
}
```

## 动态工具集 (Deferred Loading)

当工具数量过多时，使用 ToolSearch 让模型按需加载：

```typescript
const toolSearchTool: ToolDefinition = {
  name: 'tool_search',
  description: '搜索可用工具。当你不确定该用哪个工具时，先搜索。',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: '描述你想做的事' } },
    required: ['query'],
  },
  execute: async ({ query }) => {
    const results = await searchTools(query); // 语义搜索
    return results.map(t => `${t.name}: ${t.description}`).join('\n');
  },
};
```

## 完整项目脚手架

生成新 Agent 项目时的推荐目录结构：

```
my-agent/
├── src/
│   ├── index.ts           # 入口，REPL 或 HTTP 服务
│   ├── agent-loop.ts      # Agent 主循环
│   ├── tool-registry.ts   # 工具注册与执行
│   ├── tools/
│   │   ├── file-tools.ts  # read_file, write_file, edit_file
│   │   ├── search-tools.ts # grep, glob
│   │   ├── shell-tools.ts  # bash
│   │   └── index.ts       # 统一导出
│   ├── safety/
│   │   ├── loop-detector.ts
│   │   ├── token-budget.ts
│   │   └── retry.ts
│   ├── context/
│   │   ├── compression.ts
│   │   └── system-prompt.ts
│   └── session/
│       └── store.ts       # 会话持久化
├── package.json
├── tsconfig.json
└── .env                   # API keys
```

## Permission System 实现

### 四层权限模型

```typescript
interface PermissionConfig {
  mode: 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions';
  rules: {
    alwaysAllow: string[];  // e.g. ["Bash(npm:*)", "Edit"]
    alwaysDeny: string[];   // e.g. ["Bash(rm -rf:*)"]
    alwaysAsk: string[];    // e.g. ["Bash(curl:*)"]
  };
}

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\b/, /\bsudo\b/, /\bchmod\b/,
  /\bcurl\b/, /\bwget\b/, /\bssh\b/,
  /\beval\b/, /\bexec\b/,
];

function checkPermission(tool: string, args: unknown, config: PermissionConfig): 'allow' | 'deny' | 'ask' {
  if (config.mode === 'plan' && !isReadOnly(tool)) return 'deny';
  for (const p of config.rules.alwaysDeny) if (matchPattern(tool, args, p)) return 'deny';
  for (const p of config.rules.alwaysAllow) if (matchPattern(tool, args, p)) return 'allow';
  if (tool === 'bash' && DANGEROUS_PATTERNS.some(p => p.test(args.command))) return 'ask';
  return config.mode === 'bypassPermissions' ? 'allow' : 'ask';
}
```

## Read-Write Lock（工具并发控制）

```typescript
class ReadWriteLock {
  private readers = 0;
  private writer = false;
  private queue: Array<{ type: 'read' | 'write'; resolve: () => void }> = [];

  async acquireRead() {
    if (!this.writer && !this.queue.some(q => q.type === 'write')) { this.readers++; return; }
    return new Promise<void>(resolve => this.queue.push({ type: 'read', resolve }));
  }
  async acquireWrite() {
    if (!this.writer && this.readers === 0) { this.writer = true; return; }
    return new Promise<void>(resolve => this.queue.push({ type: 'write', resolve }));
  }
  releaseRead() { this.readers--; this.drain(); }
  releaseWrite() { this.writer = false; this.drain(); }

  private drain() {
    if (!this.queue.length) return;
    const next = this.queue[0];
    if (next.type === 'write' && this.readers === 0 && !this.writer) {
      this.queue.shift(); this.writer = true; next.resolve();
    } else if (next.type === 'read' && !this.writer) {
      while (this.queue[0]?.type === 'read') { this.readers++; this.queue.shift()!.resolve(); }
    }
  }
}
```

## 关键阈值参考

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| maxSteps | 20-30 | 最大循环次数 |
| budgetTokens | 200K | Token 预算上限 |
| compressionThreshold | 87% | 触发压缩的上下文占用率 |
| loopWarning | 5 次 | 循环检测警告阈值 |
| loopCritical | 8 次 | 循环检测严重阈值 |
| loopBreaker | 10 次 | 循环检测熔断阈值 |
| maxRetries | 3 | API 重试次数 |
| baseRetryDelay | 1000ms | 重试基础延迟 |
| toolResultMax | 3000-10000 chars | 工具输出截断长度 |
| slidingWindow | 30 | 循环检测滑动窗口大小 |
