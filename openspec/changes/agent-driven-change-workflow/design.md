## Context

The Hank platform currently has a manual Change management system: users create changes, write artifacts by hand, and check off tasks manually. The Agent execution loop in `session.rs` runs tools sequentially (tool_use → execute → push result → continue), with events forwarded via mpsc channel to an EventBuffer for SSE streaming.

Key existing patterns:
- `Tool` trait: `name()`, `description()`, `input_schema()`, `execute(input) -> ToolOutput`
- Agent loop in `session.rs` lines 305-367: detects `StopReason::ToolUse`, iterates tool blocks, executes each, pushes results as User message, continues loop
- `chat.rs`: builds tools vec, spawns agent task, forwarder task writes events to EventBuffer
- SSE events streamed to client via broadcast channel on EventBuffer
- Changes/Sessions both stored in MySQL with UUID primary keys

## Goals / Non-Goals

**Goals:**
- Agent-driven Change workflow: explore → generate → apply → archive
- `ask_user` tool that interrupts agent loop, presents choices to user, resumes on reply
- Dedicated session per Change for Explore/Generate phases
- Apply mode that injects change context into any Chat session
- Changes discoverable by `work_dir` from Chat header panel

**Non-Goals:**
- Multi-agent orchestration for Apply (single agent, sequential tasks)
- Real-time collaboration (multiple users on same Change)
- Change branching/merging
- Modifying the existing Agent orchestrator/worker pattern

## Decisions

### 1. `ask_user` Tool — Interrupt via Special Tool Detection

**Choice:** Detect `ask_user` tool call in the agent loop, emit a `Choices` SSE event, break the loop. Next user message resumes a new turn with the user's choice as context.

**Alternatives considered:**
- A: Output-format based (agent outputs JSON choices) — fragile, requires parsing LLM output
- B: Separate WebSocket channel — over-engineered, SSE already works

**Implementation:**
- Add `AskUserTool` to `hank-web-tools` with schema: `{ question: string, options: string[] }`
- In `session.rs` tool execution loop, after executing `ask_user`, check tool name:
  - If `ask_user`: emit `AgentEvent::AskUser { question, options, tool_use_id }`, then **break the inner tool loop** and **break the outer agent loop** (don't push tool results, don't continue)
  - Save partial conversation state (assistant message with tool_use block already pushed)
- On next user message: server detects the session has a pending `ask_user` state
  - Constructs a tool_result message with the user's choice as content
  - Resumes agent loop from that point (history includes assistant tool_use + user tool_result)

**State tracking:** Add `pending_ask_user` field to session record (nullable JSON: `{ tool_use_id, question, options }`). Cleared when user replies.

### 2. Change ↔ Session Binding

**Choice:** Add `work_dir` column to `changes` table. Add `change_id` column to `sessions` table (nullable). Sessions discover changes via shared `work_dir`. Explore/Generate get a dedicated session with `change_id` set.

**Rationale:** Changes are long-lived and reused across sessions. Binding via `work_dir` allows any session in that directory to see related changes. The dedicated `change_id` on session marks it as the Change's own Explore/Generate session.

### 3. Explore Phase — Dedicated Session with `ask_user` Loop

**Choice:** Creating a Change spawns a dedicated session. The Explore phase uses a system prompt instructing the agent to read project files and ask clarifying questions via `ask_user`. The agent loops: read code → ask question → get answer → repeat until it has enough context.

**System prompt template:**
```
You are exploring a project to understand requirements for a change.
Work directory: {work_dir}
Read project files to understand the codebase, then ask the user questions to clarify requirements.
Use the ask_user tool to present options. Keep asking until you have enough context to generate a complete proposal.
When ready, use the finalize_explore tool to signal completion.
```

### 4. Generate Phase — Single Agent Turn, Batch Output

**Choice:** After Explore completes, trigger Generate which runs one agent turn with full Explore context. Agent produces all artifacts (proposal, design, specs, tasks) in a single response. Server parses structured output and stores as draft artifacts. Client shows review UI where user can edit before confirming.

**Implementation:**
- New `generate_artifacts` tool that accepts structured JSON with all artifact contents
- Agent calls this tool once with complete artifact set
- Server stores as draft (new `status` field on artifacts: `draft` | `confirmed`)
- Client renders editable preview; on confirm, marks artifacts as `confirmed`

### 5. Apply Mode — Context Injection into Chat

**Choice:** Apply is triggered from Chat page. Server prepends change context (specs + tasks) as system prompt augmentation. The agent sees tasks and executes them sequentially, calling `UpdateTaskStatusTool` as it completes each.

**Implementation:**
- When user clicks "Apply" on a change from the Chat panel:
  - Client sends a special chat message with metadata: `{ apply_change_id: "..." }`
  - Server fetches change context (GET /api/changes/:id/context) and prepends to system prompt
  - Agent receives augmented prompt: "Implement the following tasks: ..."
  - Agent uses existing tools (shell, read, write) + UpdateTaskStatusTool

### 6. Chat Header Changes Panel

**Choice:** Add a button in Chat header that opens a dropdown/panel showing changes filtered by current session's `work_dir`. Each change shows name, status, task progress. Actions: "Explore" (opens dedicated session), "Apply" (injects into current chat).

### 7. Client Interactive Options UI

**Choice:** When SSE delivers `ask_user` event, client renders clickable option buttons + a free-text input field. Clicking an option or submitting text sends the reply back as a regular chat message (server detects pending ask_user state and routes appropriately).

## Risks / Trade-offs

- **[Partial conversation state]** Breaking the agent loop mid-tool-execution requires careful state management. → Mitigation: Store pending state in DB, reconstruct on resume. If session is abandoned, pending state is simply ignored on next fresh message.

- **[Generate quality]** Single-turn generation may produce lower quality than iterative refinement. → Mitigation: User review/edit step before confirming. Can re-trigger generate if unsatisfied.

- **[ask_user abuse]** Agent might call ask_user excessively. → Mitigation: System prompt instructs agent to batch questions. Can add max-asks-per-turn limit later.

- **[Apply scope]** Injecting full change context may exceed context window for large changes. → Mitigation: Summarize specs, include only pending tasks. Use context compression if needed.

## Migration Plan

1. Add `work_dir` column to `changes` table (nullable, backfill existing changes with NULL)
2. Add `change_id` column to `sessions` table (nullable)
3. Add `pending_ask_user` column to `sessions` table (nullable JSON)
4. Deploy server changes (new tool, modified agent loop)
5. Deploy client changes (new UI components)
6. No breaking changes to existing API — all additions are backward-compatible
