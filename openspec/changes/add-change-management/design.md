## Context

Hank 是一个 AI Agent 平台，架构为 Tauri (Vue 3 + Rust) Client + Axum Server + MySQL。当前平台支持 session 级别的对话管理，但缺少结构化的需求/变更管理能力。用户无法追踪"要做什么、设计是什么、做到哪了"。

现有技术栈：
- Server: Rust + Axum 0.8 + sqlx 0.8 (MySQL)
- Client: Vue 3.5 + Tailwind CSS 4 + Vite 6 + Tauri 2
- 统一响应格式 `ApiResponse<T>` (code/data/msg)
- 路由分 public / protected / admin 三层
- DB 操作使用 `db_retry!` 宏 + sqlx query
- Agent tools 实现 `Tool` trait (name/description/input_schema/execute)

## Goals / Non-Goals

**Goals:**
- 在 MySQL 中实现完整的 specs + changes + artifacts + tasks 数据模型
- 提供 RESTful API 管理所有实体的 CRUD
- Agent 执行时可获取 change 上下文（proposal + design + specs + tasks 组合文本）
- Agent 可通过 tool call 反向更新 spec 内容和 task 状态
- SSE 流支持推送 task/spec 状态变更事件给 Client
- Client 新增项目 Specs 页面、Changes 管理页面、Change 详情页
- Client Chat 新增 Spec 侧边面板，点击 change 注入上下文
- 归档时 delta spec 自动合并到主 specs

**Non-Goals:**
- 不实现多人协作/冲突解决（单用户场景）
- 不实现 spec 的 schema 校验（metadata 为自由 JSON，后续再加）
- 不实现 change 之间的依赖关系
- 不实现 proposal/design 的 AI 自动生成（用户手动编写或在 chat 中让 agent 帮写再粘贴）
- 不做权限细分（复用现有 JWT 认证即可）

## Decisions

### 1. Artifact 存储：Markdown body + 自由 JSON metadata

**选择**: `change_artifacts` 表使用 `content TEXT` 存 markdown 正文 + `metadata JSON` 存结构化元数据。metadata 不做 schema 校验。

**替代方案**:
- 纯 markdown（无结构化字段）→ 后续难以做字段级查询和展示
- 完全结构化 JSON → 过于死板，用户后续定制 proposal/design 格式时需要改表结构

**理由**: 混合方式最灵活。markdown 保证可读性和编辑自由度，metadata JSON 支持后续按需添加结构化字段（如 tags、priority、assignee）而不需要 migration。

### 2. Agent 上下文注入：通过 API 组装文本，注入 system prompt

**选择**: 提供 `GET /api/changes/:id/context` 端点，返回组装好的 markdown 文本。Client 在发起 chat 时将此文本附加到 system prompt。

**替代方案**:
- Server 在 chat handler 内部自动注入 → 需要 session 绑定 change_id，耦合太强
- Client 自己拼装 → 逻辑分散，不好维护

**理由**: 独立 API 端点解耦了 change 管理和 chat 执行。Client 决定何时注入、注入哪个 change，Server 只负责组装内容。

### 3. Agent 反向更新：新增 spec tools，通过 HTTP 调用 Server API

**选择**: 在 `hank-web-tools` 中新增 `UpdateSpecTool`、`UpdateTaskStatusTool`、`UpdateArtifactTool`，这些 tool 的 execute 方法内部调用 Server 的 REST API。

**替代方案**:
- 直接操作数据库 → tools 不应直接依赖 DB，且 local agent 无法直接访问 MySQL
- 通过 SSE 反向通道 → 复杂度高，不如 HTTP 调用简单

**理由**: HTTP 调用统一了 remote 和 local agent 的行为。不管 agent 在哪里执行，都通过同一套 API 更新状态。Server 在处理更新后，通过 SSE 推送事件给 Client。

### 4. 实时同步：SSE 流内夹带状态变更事件

**选择**: Agent 执行 tool call 更新 task/spec 后，Server 在当前 session 的 SSE 流中插入 `task_updated` / `spec_updated` 事件。Client 收到后刷新 Spec 面板。

**替代方案**:
- Spec 面板独立轮询 → 延迟高，浪费请求
- WebSocket → 项目不用 WebSocket，引入新协议不值得

**理由**: 复用现有 SSE 基础设施，零额外连接开销。事件格式与现有 AgentEvent 兼容。

### 5. Spec 版本管理：每次更新 version+1，存快照到 spec_versions

**选择**: `specs` 表有 `version` 字段，每次 PUT 更新时 version 自增，旧内容存入 `spec_versions` 表。归档 change 时记录 `change_id` 到 spec_versions。

**替代方案**:
- 不存历史 → 无法回溯变更
- Git-style diff → 实现复杂，对这个场景过度设计

**理由**: 快照方式简单直接，查询历史版本只需按 version 排序。存储开销可接受（spec 内容不会很大）。

### 6. 归档流程：delta spec 合并到主 specs

**选择**: `POST /api/changes/:id/archive` 时，Server 遍历该 change 的 spec artifacts，将 ADDED requirements 追加到主 spec 的 content 中，MODIFIED 替换对应段落，REMOVED 删除对应段落。合并后主 spec version+1。

**替代方案**:
- 手动合并 → 容易遗漏
- 不合并，主 spec 只是索引 → 查看主 spec 时需要聚合多个 change，查询复杂

**理由**: 自动合并保证主 spec 始终是最新完整状态。合并逻辑基于 markdown heading 匹配（`### Requirement: xxx`），实现简单可靠。

### 7. Client 页面结构

**选择**:
- Sidebar 新增 "Specs" 和 "Changes" 两个导航项
- Chat 页面右侧新增可收起的 Spec 面板
- Change 详情页使用 tab 切换 Proposal / Design / Specs / Tasks

**替代方案**:
- 全部放在 Chat 面板里 → 信息过载，不适合浏览和编辑
- 独立窗口 → Tauri 支持但增加复杂度，MVP 不需要

**理由**: Sidebar 导航适合独立浏览和管理，Chat 面板适合执行时快速查看和注入。两者互补。

## Risks / Trade-offs

- **Markdown 合并可能出错** → 基于 heading 精确匹配，如果用户手动改了 heading 格式会匹配失败。归档前做 dry-run 预览，让用户确认。
- **SSE 事件丢失** → 如果 Client 断连期间 agent 更新了 task，重连后面板状态不一致。解决：面板挂载时总是 fetch 最新状态。
- **大量 tasks 的性能** → 单个 change 可能有 50+ tasks。分组查询 + 前端虚拟滚动可解决，MVP 先不优化。
- **Agent tool call 鉴权** → spec tools 调用 Server API 需要 JWT token。Remote agent 可复用 session token；Local agent 需要 Client 传递 token。通过 tool 初始化时注入 base_url + token 解决。

## Open Questions

- Change 是否需要关联到特定 user？（当前假设单用户，不需要）
- 是否需要支持从 Chat 对话中一键创建 Change？（可作为后续增强）
