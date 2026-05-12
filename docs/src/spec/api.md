# API 接口

## Spec CRUD

### 创建 Spec

```
POST /api/specs
```

**请求体：**
```json
{
  "capability": "auth-system",
  "title": "认证系统",
  "content": "# 认证系统规格\n...",
  "metadata": null
}
```

**响应：** `201 Created`，返回完整 Spec 对象。

### 列出所有 Spec

```
GET /api/specs
```

**响应：** Spec 数组，按 capability 排序。

### 获取单个 Spec

```
GET /api/specs/{id}
```

### 更新 Spec

```
PUT /api/specs/{id}
```

**请求体（部分更新）：**
```json
{
  "content": "更新后的内容",
  "title": "新标题",
  "metadata": "{\"key\": \"value\"}"
}
```

更新时自动：
1. 创建 spec_version 快照（保存变更前状态）
2. 递增 version 字段
3. 如果请求头包含 `x-session-id`，发送 SSE 事件

### 删除 Spec

```
DELETE /api/specs/{id}
```

### 列出 Spec 版本历史

```
GET /api/specs/{id}/versions
```

**响应：** SpecVersion 数组，按 version 降序。

---

## Checkpoint 接口

### 列出 Session 的 Checkpoints

```
GET /api/sessions/{session_id}/checkpoints
```

**响应：**
```json
{
  "code": 0,
  "data": [
    {
      "id": "uuid",
      "session_id": "uuid",
      "message_id": "uuid",
      "git_commit_sha": "abc123def456...",
      "git_branch": "hank/checkpoints/session-uuid",
      "label": "修复登录页面的样式问题",
      "created_at": "2026-05-12T10:30:00Z"
    }
  ],
  "msg": "ok"
}
```

### 回退到 Checkpoint

```
POST /api/sessions/{session_id}/rewind/{checkpoint_id}
```

**前置条件：**
- Session 无正在运行的 agent task（否则返回 `409 Conflict`）
- Checkpoint 属于该 session

**执行流程：**
1. `git checkout <sha> -- .` 恢复文件
2. 从 `spec_snapshot` 恢复所有 spec 状态
3. 更新 `sessions.active_leaf_id` 到 checkpoint 的 message_id
4. 删除该 checkpoint 之后的所有 checkpoints

**响应：** `200`（无数据）或错误。

**错误码：**
- `404` — checkpoint 不存在
- `409` — agent task 正在运行

---

## Change 归档（涉及 Spec 合并）

```
POST /api/changes/{id}/archive
```

归档时对每个 `type = "spec"` 的 artifact：
1. 按 capability 查找主 Spec
2. 不存在则创建新 Spec
3. 存在则：
   - 创建 spec_version 快照
   - 调用 LLM 智能合并（失败时 fallback 到 append）
   - 更新主 Spec
