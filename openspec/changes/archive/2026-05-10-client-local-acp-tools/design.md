## Context

Hank 是一个桌面 AI agent 应用，架构为 Tauri (Vue + Rust) Client + 远端 Axum Server。当前所有 agent 工具执行都在 Server 端完成，操作远端虚拟环境的文件系统。

用户桌面上通常已安装 Claude Code（`claude` CLI）或 Codex 等 AI coding agent，这些工具通过 ACP (Agent Client Protocol) 提供标准化的 JSON-RPC over stdio 接口。我们希望让 Tauri Client 能直接调用这些本地 agent 操作用户本地项目，同时将执行记录上报 Server 统一存储。

当前 Tauri 后端几乎为空（仅 dialog plugin），需要扩展为 ACP 进程管理器。

## Goals / Non-Goals

**Goals:**
- Tauri Client 能 spawn 并管理用户本地的 ACP agent 进程
- 支持 claude-agent-acp 和 codex，以及未来其他 ACP 兼容 agent
- 同一个 session 内可同时使用远端 (Server) 和本地 (Client ACP) 两种环境
- 前端 UI 分开展示远端工具和本地工具的执行记录
- Client 将本地执行记录上报 Server 存储（历史、用量统计）
- 用户可在 Client 设置中配置本地 agent 路径

**Non-Goals:**
- 不实现 Server 端 ACP Provider（那是独立的后续工作）
- 不管理用户的 API Key（使用用户已登录的 CLI）
- 不自动安装 ACP agent（用户自行安装）
- 不实现权限确认 UI（MVP 阶段自动放行）
- 不做 WebSocket 通信（保持 HTTP/SSE + Tauri IPC 架构）

## Decisions

### 1. ACP 通信在 Tauri Rust 后端实现

**选择**: Tauri Rust 后端 spawn ACP 进程，通过 stdio JSON-RPC 通信，通过 Tauri event system 推事件给前端。

**替代方案**:
- 前端通过 Tauri shell API 直接管进程 → 前端逻辑太重，不好管理生命周期
- 用 Claude Code headless mode (`claude -p --output-format stream-json`) → 更简单但不支持多 session、resume、cancel 等 ACP 特性

**理由**: Rust 侧管理进程更可靠，Tauri event system 天然支持从后端推事件到前端，且 ACP 的 Rust SDK (`agent-client-protocol` crate) 可直接使用。

### 2. 不使用 ACP Rust SDK，自实现轻量 JSON-RPC

**选择**: 自己实现 ACP JSON-RPC 通信层（只实现需要的子集）。

**替代方案**:
- 使用 `agent-client-protocol` crate → 该 crate 可能 API 不稳定，且引入大量不需要的功能

**理由**: ACP 协议本身是简单的 JSON-RPC over stdio，我们只需要 initialize、session/new、prompt、session/cancel 几个方法。自实现可控性更强，减少外部依赖风险。如果后续需要更多 ACP 特性再考虑引入 SDK。

### 3. 统一事件模型，Tauri 侧做转换

**选择**: Tauri 后端将 ACP SessionNotification 转换为与远端 AgentEvent 兼容的事件格式，前端用同一套渲染逻辑。

**替代方案**:
- 前端两套渲染逻辑 → 维护成本高，UI 不一致

**理由**: 前端只需关心"文本块、工具调用、完成"等语义事件，不需要知道来源是 Server SSE 还是 Tauri IPC。

### 4. 本地执行记录批量上报

**选择**: 本地 agent 一轮对话完成后，Client 批量 POST 执行记录到 Server。

**替代方案**:
- 实时逐条上报 → 网络开销大，且本地执行不应依赖 Server 在线
- 不上报 → 丢失历史和用量数据

**理由**: 批量上报简单可靠，即使 Server 暂时不可达也不影响本地执行，可以后续重试。

### 5. 用户配置本地 agent

**选择**: 用户在 Client 设置中手动配置 agent 可执行文件路径。Client 启动时不自动检测。

**替代方案**:
- 自动检测 PATH 中的 agent → 可能误检测，用户可能有多个版本

**理由**: 显式配置更可控，避免歧义。设置页面提供"浏览"按钮选择路径。

## Risks / Trade-offs

- **ACP 协议变动** → 自实现 JSON-RPC 子集，变动时只需调整少量代码。关注 ACP schema 版本。
- **ACP agent 进程崩溃** → Tauri 侧监控进程状态，崩溃时通知前端并提供重启选项。
- **本地执行记录上报失败** → 本地缓存未上报记录，下次连接时重试。MVP 可先不实现重试。
- **同一 session 混合远端/本地** → 消息历史需要标记来源（remote/local），避免上下文混乱。LLM 不会看到对方环境的历史。
- **Node.js 依赖** → claude-agent-acp 需要 Node.js。这是用户的前置条件，文档说明即可。

## Open Questions

- ACP session 持久化：本地 ACP session 是否需要跨 Client 重启保持？（ACP 支持 session/list 和 session/resume）
- 同一 session 内远端和本地的消息是否在同一个对话流中展示，还是分 tab？
