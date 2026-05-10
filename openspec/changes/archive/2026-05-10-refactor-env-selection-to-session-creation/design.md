## Context

刚完成的 `client-local-acp-tools` change 在 Chat.vue 中加了一个 Remote/Local toggle，允许用户在对话中随时切换环境。经过讨论，更好的 UX 是：环境在创建 Session 时通过选择工作目录的位置来决定，之后不可变。

当前 Session 创建流程：用户点"新建" → FolderPicker 浏览 Server 文件系统 → 创建 session。需要改为 tab 切换，让用户选择 Server 路径或本机路径。

## Goals / Non-Goals

**Goals:**
- Session 创建时通过 tab 切换决定环境（Server / 本机）
- 选择本机时使用 Tauri native dialog 选路径
- Session 一旦创建，环境固定不可变
- Chat.vue 根据 session 属性自动路由消息，无需用户手动切换

**Non-Goals:**
- 不支持同一 session 内切换环境
- 不改变 ACP 通信层的实现（保持现有 Tauri commands）
- 不改变 Server 端 FolderPicker 的浏览逻辑

## Decisions

### 1. 环境信息存储在 Session 模型中

**选择**: 在 sessions 表增加 `environment` VARCHAR(16) 列，值为 "remote" 或 "local"，创建时写入。

**替代方案**: 根据 `local_work_dir` 是否有值来推断 → 不够显式，且 remote session 也可能有 local_work_dir 为空的情况。

**理由**: 显式字段更清晰，前端可以直接读取而不需要推断逻辑。

### 2. 创建 Session UI 中使用 tab 切换

**选择**: 在 SessionList 的创建 session 区域，FolderPicker 上方加 [Server] [本机] tab。Server tab 保持现有 FolderPicker，本机 tab 显示一个按钮触发 Tauri dialog。

**替代方案**: 两个独立的"创建"按钮 → 不够直观，用户可能不理解区别。

**理由**: Tab 切换是最自然的 UI 模式，用户一眼就能理解两种选择。

### 3. Chat.vue 删除运行时环境切换

**选择**: 删除 env-selector、local-dir-btn，改为在 onMounted 时读取 session 的 environment 字段来决定路由。

**理由**: 简化 Chat 组件，减少状态管理复杂度。环境已在 session 级别固定。

## Risks / Trade-offs

- **已有 local session 数据兼容** → 新增 environment 列默认值为 "remote"，已有 session 不受影响。
- **非 Tauri 环境（纯 web）** → 本机 tab 在非 Tauri 环境下隐藏或 disable，只显示 Server tab。
