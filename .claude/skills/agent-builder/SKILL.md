---
name: agent-builder
description: Generate production-grade AI Agent code from requirements. This skill should be used when users want to build an AI Agent, implement an agent loop, add tools to an agent, or scaffold agent infrastructure. Covers TypeScript/Node.js agents with streaming, tool systems, loop safety, context compression, and MCP integration.
---

# Agent Builder

Generate production-grade AI Agent implementations based on proven patterns from the Hank Agent course material.

## When to Use

- User wants to create a new AI Agent from scratch
- User wants to add agent loop, tools, or streaming to an existing project
- User asks to implement specific agent subsystems (tool registry, loop detection, token budgets, context compression)
- User wants to integrate MCP servers into an agent

## Core Architecture

An Agent is a while loop that orchestrates: Think → Act → Observe.

```
User Input → Model → [Tool Call?] → Execute Tool → Feed Result Back → Model → ... → Final Response
```

### Agent Loop Skeleton (TypeScript)

```typescript
async function agentLoop(params: {
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  tools: Record<string, ToolDefinition>;
  maxSteps?: number;
  budgetTokens?: number;
}) {
  const { model, system, messages, tools, maxSteps = 30, budgetTokens = 200_000 } = params;
  let totalTokens = 0;
  let step = 0;

  while (step < maxSteps && totalTokens < budgetTokens) {
    step++;
    const response = await generateText({
      model,
      system,
      messages,
      tools,
      maxSteps: 1,
    });

    totalTokens += response.usage.totalTokens;

    // No tool calls = model is done
    if (!response.toolCalls?.length) {
      return response.text;
    }

    // Execute tools, append results, continue loop
    const toolResults = await executeTools(response.toolCalls, tools);
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'tool', content: toolResults });
  }
}
```

## Production Hardening (Three Safety Layers)

### 1. Loop Detection — Detect repetitive behavior

Track recent tool calls. If the same tool+args appear N times consecutively, inject a nudge or break.

```typescript
interface LoopDetector {
  record(toolName: string, args: unknown): void;
  isLooping(): boolean; // true if last N calls are identical
}
```

### 2. API Fault Tolerance — Retry with exponential backoff

Handle rate limits (429), timeouts, network errors. Use exponential backoff with jitter.

```typescript
async function callWithRetry(fn, { maxRetries = 3, baseDelay = 1000 }) {
  for (let i = 0; i <= maxRetries; i++) {
    try { return await fn(); }
    catch (e) {
      if (!isRetryable(e) || i === maxRetries) throw e;
      await sleep(baseDelay * 2 ** i + Math.random() * 500);
    }
  }
}
```

### 3. Token Budget — Track cumulative consumption

Accumulate input+output tokens per loop iteration. Stop when budget exceeded.

## Tool System Design

### Tool Definition Interface

```typescript
interface ToolDefinition {
  name: string;
  description: string;           // For the model
  parameters: JSONSchema;        // JSON Schema for args
  execute: (input: any) => Promise<string>;
  isConcurrencySafe?: boolean;   // Can run in parallel?
  isReadOnly?: boolean;          // Does it modify state?
  maxOutputLength?: number;      // Truncation threshold
}
```

### Tool Registry Pattern

```typescript
class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition) { this.tools.set(tool.name, tool); }
  get(name: string) { return this.tools.get(name); }
  getSchemas() { /* return tool schemas for model */ }

  async execute(name: string, args: unknown) {
    const tool = this.tools.get(name);
    const result = await tool.execute(args);
    return this.truncate(result, tool.maxOutputLength ?? 10000);
  }

  private truncate(output: string, max: number) {
    if (output.length <= max) return output;
    return output.slice(0, max) + `\n...[truncated, ${output.length - max} chars omitted]`;
  }
}
```

### Essential Tools for Code Agents

| Tool | Purpose | Key Detail |
|------|---------|------------|
| `read_file` | Read file content | Truncate large files |
| `edit_file` | Precise string replacement | old_string → new_string, must be unique match |
| `write_file` | Create/overwrite file | For new files only |
| `grep` | Search file contents | Regex support, return with line numbers |
| `glob` | Find files by pattern | Return sorted paths |
| `bash` | Execute shell commands | Timeout + output truncation required |
| `list_directory` | List dir contents | Shallow listing |

### Parallel Tool Execution

When multiple tool calls arrive in one response, execute concurrency-safe tools in parallel:

```typescript
async function executeTools(calls, registry) {
  const safe = calls.filter(c => registry.get(c.name)?.isConcurrencySafe);
  const unsafe = calls.filter(c => !registry.get(c.name)?.isConcurrencySafe);

  const results = await Promise.all(safe.map(c => registry.execute(c.name, c.args)));
  for (const c of unsafe) {
    results.push(await registry.execute(c.name, c.args));
  }
  return results;
}
```

## Streaming

Use streaming for real-time output. Process `text-delta` and `tool-call` events:

```typescript
const stream = streamText({ model, system, messages, tools });
for await (const event of stream) {
  if (event.type === 'text-delta') process.stdout.write(event.textDelta);
  if (event.type === 'tool-call') { /* execute and continue */ }
}
```

## Context Compression

When conversation grows too long, compress older messages using a summarization call:

```typescript
async function compressContext(messages: Message[], model) {
  const oldMessages = messages.slice(0, -4); // Keep recent
  const summary = await generateText({
    model,
    system: 'Summarize this conversation preserving key facts, decisions, and file paths.',
    messages: [{ role: 'user', content: formatMessages(oldMessages) }],
  });
  return [
    { role: 'user', content: `[Previous conversation summary]\n${summary}` },
    ...messages.slice(-4),
  ];
}
```

Trigger compression when token count exceeds ~80% of context window.

## MCP Integration

To connect external tools via MCP (Model Context Protocol):

```typescript
import { experimental_createMCPClient } from 'ai';

const mcpClient = await experimental_createMCPClient({
  transport: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
});
const mcpTools = await mcpClient.tools(); // Returns tool definitions
// Merge with local tools and pass to model
```

## Session Persistence

Store conversation history to enable resume:

```typescript
interface SessionStore {
  save(sessionId: string, messages: Message[]): Promise<void>;
  load(sessionId: string): Promise<Message[] | null>;
  list(): Promise<{ id: string; title: string; updatedAt: Date }[]>;
}
```

## Permission System (Four Layers)

Production agents need permission control to prevent dangerous operations:

1. **Modes** — plan (read-only), default (write needs confirm), full (auto-allow)
2. **Rules** — alwaysAllow/alwaysDeny/alwaysAsk patterns per tool
3. **Dangerous Pattern Detection** — regex matching for rm -rf, sudo, curl, etc.
4. **Interactive Confirmation** — prompt user for unrecognized operations

## Prompt Pipe Pattern

Modular system prompt composition with conditional sections:

```typescript
class PromptBuilder {
  private pipes: Array<(ctx: PromptContext) => string | null> = [];
  pipe(fn: (ctx: PromptContext) => string | null) { this.pipes.push(fn); return this; }
  build(ctx: PromptContext): string {
    return this.pipes.map(fn => fn(ctx)).filter(Boolean).join('\n\n');
  }
}
// Static sections first (cache-friendly), dynamic sections last
```

## Output Truncation Strategy (Head/Tail 60/40)

Preserve both file headers and footers:

```typescript
function truncate(text: string, maxChars = 3000): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, maxChars * 0.6);
  const tail = text.slice(-(maxChars * 0.4));
  return `${head}\n\n... [省略 ${text.length - maxChars} 字符] ...\n\n${tail}`;
}
```

## Advanced Loop Detection (Three-Level Response)

- **Warning** (5 repeats): Inject nudge message, continue
- **Critical** (8 repeats): Force different approach
- **Circuit Breaker** (10 repeats): Hard stop

Fingerprint: `SHA256(toolName + JSON.stringify(args))` in sliding window of 30 calls.

## Implementation Checklist

When generating an agent, ensure:

1. [ ] Agent loop with configurable maxSteps
2. [ ] Token budget tracking and enforcement
3. [ ] Loop detection with three-level response
4. [ ] API retry with exponential backoff + jitter
5. [ ] Tool registry with schema generation
6. [ ] Output truncation (head/tail 60/40)
7. [ ] Read-write lock for tool concurrency
8. [ ] Streaming support for real-time output
9. [ ] Proper error handling (tool errors → actionable messages for model)
10. [ ] System prompt via Prompt Pipe pattern
11. [ ] Context compression (microcompact + LLM summarization)
12. [ ] Session persistence (JSONL append-only)
13. [ ] Permission system for dangerous operations

## Reference Material

For detailed implementation patterns, consult:
- `references/architecture-patterns.md` — Full architecture decisions, code examples, and tradeoffs
