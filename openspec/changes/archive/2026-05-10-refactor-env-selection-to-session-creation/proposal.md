## Why

环境选择（Remote/Local）不应该是 Chat 界面中的一个独立 toggle，而应该在创建 Session 选择工作目录时自然决定。工作目录的位置本身就决定了环境：选 Server 路径 → remote，选本机路径 → local。当前实现有独立的环境切换按钮和运行时切换能力，这增加了不必要的复杂度和用户认知负担。

## What Changes

- 删除 Chat.vue 中的 environment selector（Remote/Local toggle）
- 删除 Chat.vue 中的 local work directory picker
- Session 创建流程中的 FolderPicker 增加 tab 切换（Server / 本机）
- Session 模型增加 `environment` 字段（"remote" | "local"），创建时写入，不可变
- Chat.vue 的消息路由改为根据 session.environment 字段决定，而非 UI toggle
- 本机 tab 使用 Tauri dialog 选择本地路径

## Capabilities

### New Capabilities

### Modified Capabilities
- `client-local-tools-ui`: 环境选择从 Chat 运行时 toggle 改为 Session 创建时 tab 选择，session 级别固定环境

## Impact

- `client/src/components/Chat.vue`: 删除 env-selector、local-dir-btn、environment ref；send() 改为读 session 属性
- `client/src/components/SessionList.vue` 或创建 session 的 UI: 增加 Server/本机 tab
- `client/src/composables/useSession.ts`: Session 接口增加 environment 字段，createSession 传入 environment
- `crates/hank-db/src/lib.rs`: sessions 表增加 environment 列
- `server/src/routes.rs`: create_session 接受 environment 参数
