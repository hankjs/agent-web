# Checkpoint 与回退

## 概述

Checkpoint 系统为 Agent 对话提供"时间旅行"能力。每轮用户消息前自动创建快照，用户可以随时回退到任意历史点，同时恢复代码文件和 Spec 状态。

## 工作原理

### 创建 Checkpoint

```
用户发送消息
    │
    ▼
chat.rs: 保存用户消息到 DB
    │
    ▼
chat.rs: tokio::spawn 异步创建 checkpoint
    │
    ├── 1. 检查 work_dir 是否是 git 仓库
    ├── 2. git add -A（暂存所有文件）
    ├── 3. git write-tree（写入 tree 对象）
    ├── 4. git reset（恢复 index）
    ├── 5. git commit-tree（在 orphan 分支创建 commit）
    ├── 6. git update-ref（更新分支指针）
    ├── 7. 捕获所有 spec 的 JSON 快照
    └── 8. 写入 checkpoints 表
    │
    ▼
chat.rs: spawn agent task（正常执行）
```

### Git 命令详解

使用 `write-tree` + `commit-tree` 方式，**不切换分支、不影响工作区**：

```bash
# 将工作区写入 tree（需要先 add）
git add -A
TREE=$(git write-tree)
git reset  # 撤销 add，不影响用户的 staging

# 在 orphan 分支追加 commit
# 如果分支已存在，以当前分支 HEAD 为 parent
PARENT=$(git rev-parse --verify refs/heads/hank/checkpoints/{session_id})
COMMIT=$(git commit-tree $TREE -p $PARENT -m "checkpoint: {label}")
git update-ref refs/heads/hank/checkpoints/{session_id} $COMMIT
```

### 恢复 Checkpoint（Rewind）

```
用户点击 Rewind 按钮
    │
    ▼
前端: confirm 确认对话框
    │
    ▼
POST /api/sessions/{id}/rewind/{checkpoint_id}
    │
    ├── 1. 检查无运行中的 agent task
    ├── 2. git checkout {sha} -- .（恢复所有文件）
    ├── 3. git reset（清理 index）
    ├── 4. 从 spec_snapshot 恢复 spec 状态
    ├── 5. 更新 session.active_leaf_id
    └── 6. 删除后续 checkpoints
    │
    ▼
前端: 刷新消息树 + 重新加载对话
```

## 边界情况

| 场景 | 行为 |
|------|------|
| work_dir 不是 git 仓库 | 跳过 checkpoint 创建，不报错 |
| git 命令执行失败 | log warning，不阻塞对话 |
| agent task 运行中尝试 rewind | 返回 409 Conflict |
| 多个 session 操作同一仓库 | 各自独立 orphan 分支，互不影响 |
| checkpoint 分支被外部删除 | rewind 时返回错误 |
| rewind 后继续对话 | 新消息从 rewind 点分叉（利用 message tree） |

## 存储开销

- Git 对象存储天然去重，相同文件只存一份
- Orphan 分支与主仓库共享 object store
- 每个 checkpoint 的增量开销约等于该轮修改的文件大小
- `spec_snapshot` 是 JSON 文本，通常几 KB

## 清理策略

当前实现中，rewind 会删除目标 checkpoint 之后的所有 checkpoints。Session 删除时通过 FK CASCADE 自动清理 DB 记录。

Git 分支上的 commit 不会主动清理（可通过 `git gc` 自然回收无引用对象）。如需主动清理，可在 session 删除时执行：

```bash
git branch -D hank/checkpoints/{session_id}
```
