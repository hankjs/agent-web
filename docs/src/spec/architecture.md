# 架构设计

## 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (Vue 3)                      │
│  Chat.vue ──→ Rewind Button ──→ checkpoints API          │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP
┌──────────────────────────▼──────────────────────────────┐
│                   Backend (Axum)                          │
│                                                          │
│  chat.rs ─────→ checkpoints.rs ─────→ git commands       │
│     │                  │                                 │
│     │                  ├── create_checkpoint_for_turn()   │
│     │                  ├── rewind_handler()               │
│     │                  └── spec snapshot capture/restore  │
│     │                                                    │
│  changes.rs ──→ llm_merge_specs() ──→ LLM Provider       │
│                                                          │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                    Storage Layer                          │
│                                                          │
│  MySQL (hank-db)          Git (用户仓库)                  │
│  ├── specs                ├── 用户分支 (不动)             │
│  ├── spec_versions        └── hank/checkpoints/{sid}     │
│  └── checkpoints              (orphan branch)            │
└─────────────────────────────────────────────────────────┘
```

## 模块职责

### `server/src/checkpoints.rs`

Checkpoint 系统的核心模块，负责：

- **Git 操作**：通过 `tokio::process::Command` 执行 git 命令
- **Checkpoint 创建**：`write-tree` → `commit-tree` → `update-ref`
- **Checkpoint 恢复**：`git checkout <sha> -- .` + spec 快照恢复
- **API 处理**：list / rewind 端点

### `server/src/chat.rs`（集成点）

在 agent task spawn 前，异步创建 checkpoint：

```rust
// chat.rs 中的 hook 位置
if let Some(ref wd) = work_dir_for_checkpoint {
    tokio::spawn(async move {
        create_checkpoint_for_turn(&state, &session_id, &message_id, &work_dir, &label).await
    });
}
```

### `server/src/changes.rs`（合并逻辑）

Change 归档时调用 `llm_merge_specs()` 替代简单 append。

## 关键设计决策

### 为什么用 orphan branch？

- 不污染用户的 commit 历史和分支列表
- 每个 session 独立分支，互不干扰
- Git 对象存储天然去重，空间开销小

### 为什么用 write-tree 而非 stash/checkout？

- `git stash` 会影响用户的 stash 列表
- `git checkout` 切换分支会中断用户工作
- `write-tree` + `commit-tree` 是纯对象操作，不影响 HEAD、index 或工作区

### 为什么 checkpoint 是异步的？

- 创建 checkpoint 涉及 git 操作，可能耗时
- 不应阻塞用户的对话请求
- 失败时只 log 不中断，保证可用性
