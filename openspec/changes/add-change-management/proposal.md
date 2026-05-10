## Why

Hank 平台目前缺少结构化的需求变更管理能力。用户在使用 Agent 开发功能时，没有一个地方可以追踪"要做什么、怎么做、做到哪了"。需要引入类似 OpenSpec 的 Change Management 系统，让用户在 Client 端可视化管理变更单（Change），追踪任务进度，并在 Agent 执行时自动注入设计上下文。同时 Agent 也能反向更新 spec 和 task 状态，形成闭环。

## What Changes

- Server 新增 `specs` 表和 API，管理项目主规格（按能力分类，支持版本历史）
- Server 新增 `changes`、`change_artifacts`、`change_tasks` 表和 API，管理变更单生命周期
- Server 新增 `/api/changes/:id/context` 端点，为 Agent 执行组装完整上下文
- Agent 新增 tool：`update_spec`、`update_task_status`、`update_artifact`，支持运行时反向更新
- Agent 执行 chat 时，SSE 流支持推送 `task_updated`、`spec_updated` 事件
- Client 新增"项目 Specs"页面，展示和编辑主规格
- Client 新增"Changes"页面，管理变更单列表（创建、查看、归档）
- Client 新增 Change 详情页（Proposal / Design / Specs / Tasks 四个 tab）
- Client Chat 新增 Spec 侧边面板，展示 Change 列表，点击注入上下文到当前对话
- Client Spec 面板实时响应 SSE 事件刷新 task/spec 状态

## Capabilities

### New Capabilities

- `spec-management`: 主规格的 CRUD、版本历史、按能力分类管理
- `change-management`: 变更单生命周期管理（创建、编辑 artifacts、任务追踪、归档合并）
- `change-context-injection`: Agent 执行时注入 change 上下文，以及 Agent 通过 tool call 反向更新 spec/task
- `client-change-ui`: Client 端 Changes 列表、详情页、Specs 页面、Chat Spec 面板的可视化管理

### Modified Capabilities

## Impact

- `server/src/routes/`: 新增 specs.rs、changes.rs 路由模块
- `crates/hank-db/`: 新增 specs.rs、changes.rs 数据库操作，新增 4 张表的 migration
- `crates/hank-web-tools/`: 新增 spec_tools.rs（Agent 可调用的 update_spec / update_task_status / update_artifact）
- `server/src/`: chat handler 扩展，支持注入 change context 和推送状态变更事件
- `client/src/views/`: 新增 Specs.vue、Changes.vue、ChangeDetail.vue
- `client/src/components/`: 新增 SpecPanel.vue（Chat 侧边面板）
- `client/src/api/`: 新增 specs.ts、changes.ts API 封装
