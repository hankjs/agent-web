## 1. Server: Local Event Recording API

- [x] 1.1 Add `local_agent` and `local_work_dir` nullable columns to sessions table (hank-db migration)
- [x] 1.2 Update session CRUD to include local_agent and local_work_dir fields
- [x] 1.3 Create `local_events` table (id, session_id, event_type, agent_type, payload JSON, source, created_at)
- [x] 1.4 Add POST `/api/sessions/{id}/local-events` endpoint that accepts batch event array
- [x] 1.5 Add GET `/api/sessions/{id}/events` endpoint that returns both remote and local events with source marker

## 2. Tauri: ACP Process Manager

- [x] 2.1 Add serde, serde_json, tokio (process features) dependencies to src-tauri/Cargo.toml
- [x] 2.2 Create `src-tauri/src/acp/mod.rs` module structure (mod.rs, process.rs, jsonrpc.rs, events.rs)
- [x] 2.3 Implement JSON-RPC message types (Request, Response, Notification) in jsonrpc.rs
- [x] 2.4 Implement AcpProcess struct: spawn child process with stdio pipes, read/write JSON-RPC
- [x] 2.5 Implement process health monitoring (detect unexpected exit, emit error events)
- [x] 2.6 Implement graceful stop (SIGTERM → 5s timeout → SIGKILL)

## 3. Tauri: ACP Communication Protocol

- [x] 3.1 Implement `initialize` request/response handling (declare client capabilities)
- [x] 3.2 Implement `session/new` request (create ACP session with work directory)
- [x] 3.3 Implement `prompt` request (send user message to agent)
- [x] 3.4 Implement `session/cancel` notification (cancel in-progress prompt)
- [x] 3.5 Implement SessionNotification parsing (text chunks, tool calls, tool results, done)
- [x] 3.6 Implement ReadTextFile request handler (agent requests file read → read local fs → respond)
- [x] 3.7 Implement WriteTextFile request handler (agent requests file write → write local fs → respond)
- [x] 3.8 Implement RequestPermission handler (auto-approve in MVP)

## 4. Tauri: Event Bridge & Commands

- [x] 4.1 Define unified event types for frontend (TextDelta, ToolUse, ToolResult, Done, Error)
- [x] 4.2 Implement ACP SessionNotification → unified event conversion
- [x] 4.3 Register Tauri commands: `acp_new_session`, `acp_prompt`, `acp_cancel`, `acp_stop`
- [x] 4.4 Register Tauri commands: `acp_get_agents`, `acp_add_agent`, `acp_remove_agent`, `acp_test_agent`
- [x] 4.5 Emit Tauri events (`acp-event`) to frontend as notifications arrive
- [x] 4.6 Implement local event batch upload to Server after prompt completes

## 5. Tauri: Agent Configuration Persistence

- [x] 5.1 Define agent config structure (name, agent_type, binary_path)
- [x] 5.2 Implement config persistence using Tauri app data directory (JSON file)
- [x] 5.3 Implement `acp_test_agent` command: spawn → initialize → close → report success/failure

## 6. Frontend: Local Agent Settings

- [x] 6.1 Create LocalAgentSettings.vue component (list agents, add/remove, test connection)
- [x] 6.2 Add settings navigation/access point in the UI
- [x] 6.3 Implement folder picker for agent binary path (reuse Tauri dialog plugin)

## 7. Frontend: Environment Selector & Chat Integration

- [x] 7.1 Add environment selector to Chat.vue (Remote / Local toggle)
- [x] 7.2 Add local work directory picker in chat header (for local environment)
- [x] 7.3 Implement message routing: local messages → Tauri IPC, remote messages → HTTP/SSE
- [x] 7.4 Consume `acp-event` Tauri events and render in chat (reuse existing block rendering)
- [x] 7.5 Add source badge (Server/Local) to tool execution blocks
- [x] 7.6 Display local agent status indicator (Running/Stopped/Not Configured)
- [x] 7.7 Implement cancel button for local agent prompts
