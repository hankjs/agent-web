## 1. Server: Session 模型增加 environment 字段

- [x] 1.1 Add `environment` VARCHAR(16) DEFAULT 'remote' column to sessions table (hank-db migration)
- [x] 1.2 Update Session struct to include `environment` field
- [x] 1.3 Update all session SELECT queries to include `environment`
- [x] 1.4 Update `create_session` to accept and store `environment` parameter
- [x] 1.5 Update server `CreateSessionRequest` to accept `environment` field

## 2. Frontend: Session 创建流程增加 tab 切换

- [x] 2.1 Update `Session` interface in useSession.ts to include `environment` field
- [x] 2.2 Update `createSession` function to accept and pass `environment` parameter
- [x] 2.3 Add Server/本机 tab UI to session creation area in SessionList.vue
- [x] 2.4 Server tab: keep existing FolderPicker behavior
- [x] 2.5 本机 tab: add Tauri dialog button to select local path
- [x] 2.6 Detect Tauri environment and hide 本机 tab when not available
- [x] 2.7 Pass selected environment and path to createSession

## 3. Frontend: Chat.vue 清理运行时切换

- [x] 3.1 Remove env-selector (Remote/Local toggle) from Chat.vue template and styles
- [x] 3.2 Remove local-dir-btn from Chat.vue template and styles
- [x] 3.3 Remove `environment` ref and replace with computed from session prop
- [x] 3.4 Add `environment` prop to Chat.vue (passed from App.vue via currentSession)
- [x] 3.5 Update send() to route based on session environment prop instead of local ref
- [x] 3.6 Update stop() to route based on session environment prop
- [x] 3.7 Keep agent status indicator, source badges, and acp-event consumption (unchanged)
