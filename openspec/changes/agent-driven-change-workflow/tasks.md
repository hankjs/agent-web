## 1. Database Schema Changes

- [x] 1.1 Add `work_dir` column (VARCHAR, nullable) to `changes` table
- [x] 1.2 Add `change_id` column (VARCHAR, nullable) to `sessions` table
- [x] 1.3 Add `pending_ask_user` column (JSON, nullable) to `sessions` table
- [x] 1.4 Add `explore_summary` column (TEXT, nullable) to `changes` table
- [x] 1.5 Add `status` column to `change_artifacts` table (enum: draft/confirmed, default confirmed)

## 2. Database CRUD Updates (hank-db)

- [x] 2.1 Update `create_change` to accept and store `work_dir`
- [x] 2.2 Add `list_changes_by_work_dir(work_dir)` query
- [x] 2.3 Add `get_session_pending_ask_user(session_id)` and `set_session_pending_ask_user(session_id, json)` and `clear_session_pending_ask_user(session_id)`
- [x] 2.4 Add `update_change_explore_summary(change_id, summary)`
- [x] 2.5 Add `get_session_by_change_id(change_id)` query
- [x] 2.6 Add `set_session_change_id(session_id, change_id)` query
- [x] 2.7 Update `create_artifact` / `update_artifact` to handle `status` field (draft/confirmed)
- [x] 2.8 Add `confirm_artifacts(change_id)` — batch update all draft artifacts to confirmed

## 3. Server: ask_user Tool

- [x] 3.1 Create `AskUserTool` in hank-web-tools with schema `{ question: string, options: string[] }`
- [x] 3.2 Add `AgentEvent::AskUser { question, options, tool_use_id }` variant to types.rs
- [x] 3.3 Modify agent loop in session.rs: detect `ask_user` tool name, emit AskUser event, break loop after saving assistant message
- [x] 3.4 In chat.rs: after agent loop completes, check if ask_user was triggered — if so, persist pending_ask_user state to session
- [x] 3.5 In chat.rs: on new message, check pending_ask_user — if set, construct tool_result history and clear state before starting agent turn
- [x] 3.6 Register `AskUserTool` in chat.rs tools vec

## 4. Server: Explore Session & Tools

- [x] 4.1 Add `POST /api/changes/:id/explore` endpoint — creates or reuses dedicated session, returns session_id
- [x] 4.2 Create `FinalizeExploreTool` in hank-web-tools with schema `{ summary: string }`
- [x] 4.3 Add `AgentEvent::ExploreComplete { change_id, summary }` variant
- [x] 4.4 Implement FinalizeExploreTool: stores summary on change, emits ExploreComplete event
- [x] 4.5 Define Explore system prompt template (read project files, ask questions, finalize when ready)
- [x] 4.6 In chat.rs: when session has change_id and is explore session, use Explore system prompt and register FinalizeExploreTool

## 5. Server: Generate Phase

- [x] 5.1 Add `POST /api/changes/:id/generate` endpoint — validates explore complete, starts agent turn with Generate prompt
- [x] 5.2 Create `GenerateArtifactsTool` in hank-web-tools with schema for structured artifact output
- [x] 5.3 Implement GenerateArtifactsTool: stores artifacts with status=draft, emits GenerateComplete event
- [x] 5.4 Add `AgentEvent::GenerateComplete { change_id, artifact_count }` variant
- [x] 5.5 Define Generate system prompt template (synthesize explore context into artifacts)
- [x] 5.6 Add `POST /api/changes/:id/artifacts/confirm` endpoint — batch confirm all draft artifacts

## 6. Server: Apply Integration

- [x] 6.1 Extend `ChatRequest` to accept optional `apply_change_id` field
- [x] 6.2 Add `GET /api/changes/:id/apply-context` endpoint — returns formatted markdown with specs + tasks
- [x] 6.3 In chat.rs: when `apply_change_id` is present, fetch apply context and augment system prompt
- [x] 6.4 In chat.rs: set session's `change_id` when apply is triggered
- [x] 6.5 Update `GET /api/changes` to support `?work_dir=` query parameter filter

## 7. Client: API Layer Updates

- [x] 7.1 Add `startExplore(changeId)` API call → POST /api/changes/:id/explore
- [x] 7.2 Add `triggerGenerate(changeId)` API call → POST /api/changes/:id/generate
- [x] 7.3 Add `confirmArtifacts(changeId)` API call → POST /api/changes/:id/artifacts/confirm
- [x] 7.4 Add `getApplyContext(changeId)` API call → GET /api/changes/:id/apply-context
- [x] 7.5 Update `listChanges` to accept optional `work_dir` parameter
- [x] 7.6 Update `createChange` to accept `work_dir` parameter

## 8. Client: Interactive Options UI (ask_user)

- [x] 8.1 Create `AskUserOptions.vue` component — renders question, option buttons, free-text input
- [x] 8.2 Handle `ask_user` SSE event in Chat message stream — insert AskUserOptions into message list
- [x] 8.3 Implement option click → send as chat message to session
- [x] 8.4 Implement free-text submit → send as chat message to session
- [x] 8.5 Disable options after user replies, show selected state

## 9. Client: Changes Chat Panel

- [x] 9.1 Create `ChangeChatPanel.vue` — panel component listing changes filtered by work_dir
- [x] 9.2 Display each change with name, status badge, task progress (done/total)
- [x] 9.3 Implement contextual action buttons per change state (Explore/Generate/Apply/Archive/View)
- [x] 9.4 Add "New Change" button that creates change with current work_dir
- [x] 9.5 Add "Changes" button to Chat.vue header (visible when session has work_dir)
- [x] 9.6 Wire panel open/close toggle from header button
- [x] 9.7 Handle SSE events (task_updated, explore_complete, generate_complete) to refresh panel state

## 10. Client: Explore UI

- [x] 10.1 Implement "Explore" action from ChangeChatPanel — call startExplore, navigate to explore session
- [x] 10.2 Reuse Chat.vue for explore session display (messages + ask_user options)
- [x] 10.3 Show explore status indicator (in progress / completed) in panel
- [x] 10.4 Handle ExploreComplete event — update panel to show "Generate" action

## 11. Client: Generate UI

- [x] 11.1 Implement "Generate" action from ChangeChatPanel — call triggerGenerate
- [x] 11.2 Create `ArtifactReview.vue` — displays draft artifacts in editable form (tabs per artifact type)
- [x] 11.3 Handle GenerateComplete event — show ArtifactReview UI
- [x] 11.4 Implement edit functionality on draft artifacts (inline markdown editor)
- [x] 11.5 Implement "Confirm" button — calls confirmArtifacts, updates panel state

## 12. Client: Apply Integration

- [x] 12.1 Implement "Apply" action from ChangeChatPanel — sends chat message with apply_change_id to current session
- [x] 12.2 Show active change indicator in Chat when apply is in progress
- [x] 12.3 Update task progress in panel as task_updated events arrive during apply
