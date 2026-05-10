## Why

The current Change management system is manual CRUD — users create changes, write proposals/designs/specs/tasks by hand, and manually check off tasks. This defeats the purpose of having an AI agent platform. The workflow should be Agent-driven: the Agent reads project code, asks clarifying questions via interactive UI, generates artifacts automatically, and executes tasks — mirroring the OpenSpec CLI flow (explore → ff → apply → archive).

## What Changes

- Add `ask_user` tool that interrupts Agent turn, sends choices via SSE, and waits for user reply
- Add dedicated Explore session per Change where Agent asks questions to clarify requirements
- Add Generate phase that creates all artifacts (proposal/design/specs/tasks) at once for user review
- Add Apply trigger from Chat that injects change context + system prompt to drive task execution
- Bind Changes to `work_dir` so sessions can discover related changes
- Add Change panel in Chat header (filtered by work_dir) for selecting/injecting changes
- Add interactive option-style UI for Agent questions (clickable buttons + free text input)
- Store modification records on Changes (not message history) — changes are reused across sessions

## Capabilities

### New Capabilities
- `agent-ask-user-tool`: Server-side `ask_user` tool that interrupts the agent execution loop, emits a `choices` SSE event with options, and resumes when the user replies
- `change-explore-session`: Dedicated session per Change for the Explore phase — Agent reads project files, asks questions via `ask_user`, builds understanding of requirements
- `change-generate-phase`: Generate all change artifacts at once based on Explore context, present for user review/edit before saving
- `change-apply-integration`: Inject change context (specs + tasks) into Chat session as system prompt to drive automated task execution
- `change-chat-panel`: Chat header control that opens a panel listing changes filtered by current `work_dir`, with inject/dismiss actions

### Modified Capabilities
- `client-local-tools-ui`: Chat header layout changes to accommodate the new Changes control button

## Impact

- **Server (hank-agent)**: New `ask_user` tool implementation, agent loop interruption logic in `session.rs`
- **Server (hank-web-tools)**: Register `ask_user` tool alongside existing tools
- **Server (chat.rs)**: Handle `ask_user` tool detection, break loop, emit `choices` SSE event; handle user reply to resume
- **Database (hank-db)**: Add `work_dir` and `session_id` columns to `changes` table; add `change_id` to `sessions` table
- **Client API**: New endpoints for explore session, generate, apply trigger
- **Client Components**: New ChangeExplore.vue, ChangeGenerate.vue, ChangeChatPanel.vue; modify Chat.vue header
- **Client Composables**: Extend useSession to track active change context
