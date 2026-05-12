# 数据模型

## specs 表

主 Spec 存储，每个 capability 唯一。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID 主键 |
| capability | VARCHAR(255) | 能力标识，唯一约束 |
| title | VARCHAR(255) | 显示标题 |
| content | MEDIUMTEXT | Spec 完整内容 |
| metadata | JSON | 扩展元数据 |
| version | INT | 版本号，内容变更时自增 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 最后更新时间 |

## spec_versions 表

Spec 的历史快照，每次更新前自动创建。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID 主键 |
| spec_id | VARCHAR(36) | 关联的 spec ID (FK) |
| version | INT | 快照时的版本号 |
| content | MEDIUMTEXT | 快照时的内容 |
| metadata | JSON | 快照时的元数据 |
| change_id | VARCHAR(36) | 触发此版本的 change ID（可选） |
| created_at | DATETIME | 快照创建时间 |

## checkpoints 表

对话级别的状态快照，关联 git commit 和 spec 状态。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID 主键 |
| session_id | VARCHAR(36) | 关联的会话 ID (FK) |
| message_id | VARCHAR(36) | 触发该轮对话的用户消息 ID |
| git_commit_sha | VARCHAR(40) | orphan 分支上的 commit hash |
| git_branch | VARCHAR(255) | 分支名，如 `hank/checkpoints/{session_id}` |
| spec_snapshot | JSON | 所有 spec 的完整状态快照 |
| label | VARCHAR(255) | 标签，取用户消息前 40 字符 |
| created_at | DATETIME | 创建时间 |

### spec_snapshot JSON 格式

```json
[
  {
    "id": "uuid",
    "capability": "auth-system",
    "title": "认证系统",
    "content": "完整 spec 内容...",
    "metadata": null,
    "version": 3
  }
]
```

## 实体关系

```
sessions 1──N checkpoints
    │
    └── active_leaf_id ──→ messages (rewind 时更新)

specs 1──N spec_versions
  │
  └── capability ←── change_artifacts.capability (归档时关联)

changes 1──N change_artifacts (type = "spec")
    │
    └── id ──→ spec_versions.change_id (归档时记录)
```
