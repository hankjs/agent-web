## Why

Hank 目前所有工具执行都在 Server 端（远端虚拟环境）。用户桌面上已经安装了 Claude Code、Codex 等 AI coding agent，但无法在 Hank 中使用它们操作本地项目。需要让 Tauri Client 能直接调用用户本地已有的 ACP agent，同时 Server 记录执行历史，UI 上分开展示远端和本地两类工具。

## What Changes

- Tauri Rust 后端新增 ACP Manager 模块，负责 spawn/管理本地 ACP agent 进程（claude-agent-acp、codex 等）
- Tauri 通过 stdio JSON-RPC 与本地 ACP agent 通信，支持 session 管理、prompt、流式事件
- 前端新增本地环境面板，展示本地 ACP agent 状态和工具执行记录
- 前端 Chat 支持将消息路由到本地 Agent（同一 session 内可切换远端/本地）
- Client 设置页面支持配置本地 ACP agent 路径
- Server 新增 API 接收 Client 上报的本地执行记录
- Session 模型扩展，支持关联本地 agent 和本地工作目录

## Capabilities

### New Capabilities

- `client-acp-manager`: Tauri 侧 ACP 进程生命周期管理（spawn、stop、检测可用 agents）
- `client-acp-communication`: Tauri 与 ACP agent 的 JSON-RPC 通信（initialize、prompt、session 管理、事件流）
- `client-local-tools-ui`: 前端本地环境面板和工具执行记录展示，与远端工具分类展示
- `server-local-event-recording`: Server 接收并存储 Client 上报的本地 ACP 执行记录

### Modified Capabilities

## Impact

- `client/src-tauri/`: 新增 ACP manager 模块、Tauri commands、依赖 `agent-client-protocol` crate 或自实现 JSON-RPC
- `client/src/`: 新增本地环境 UI 组件、设置页面、Tauri IPC 调用
- `server/src/`: 新增本地事件上报 API endpoint
- `crates/hank-db/`: Session 表扩展（local_agent、local_work_dir 字段）
- 外部依赖：用户需自行安装 `claude-agent-acp` 或 `codex` 等 ACP agent
