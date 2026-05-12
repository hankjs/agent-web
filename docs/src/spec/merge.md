# 智能合并

## 问题背景

Change 归档时需要将 artifact 中的 spec 内容合并到主 Spec。之前的实现是简单 append：

```rust
// 旧逻辑：无脑拼接
let merged = format!("{}\n\n{}", spec.content, artifact.content);
```

这导致：
- 多次归档后 spec 内容无限膨胀
- 重复内容堆积
- 结构混乱，可读性差

## 解决方案

使用 LLM 进行智能合并，将新内容与现有 spec 整合为一个结构清晰、无重复的文档。

### 调用流程

```rust
// changes.rs archive_change 中
let merged = match llm_merge_specs(&state, &spec.content, &artifact.content, capability).await {
    Ok(m) => m,
    Err(e) => {
        // fallback: 合并失败时退回 append
        tracing::warn!("LLM merge failed, falling back to append: {e:#}");
        format!("{}\n\n{}", spec.content, artifact.content)
    }
};
```

### Prompt 设计

```
你是一个技术文档合并助手。请将以下两段 Spec 文档合并为一个完整、无重复、结构清晰的文档。

## 现有 Spec: {capability}

{existing_content}

## 新增内容

{new_content}

请直接输出合并后的完整文档，不要添加额外解释。
```

### 技术实现

- 使用系统中配置的默认 LLM Provider（通过 `provider_registry::resolve_default`）
- 流式读取响应，拼接完整文本
- max_tokens: 4096
- 无 system prompt，无 tools

### 容错机制

| 失败场景 | 处理 |
|----------|------|
| 无可用 Provider | 直接 fallback 到 append |
| LLM 流式响应出错 | fallback 到 append |
| LLM 返回空内容 | fallback 到 append |
| 网络超时 | 由 provider 层处理超时，返回 error 后 fallback |

### 合并质量

LLM 合并的预期效果：
- 去除重复段落
- 保持文档结构（标题层级、列表格式）
- 将新增内容整合到合适的位置
- 保留所有有效信息，不丢失细节

如果对合并结果不满意，可以通过 `PUT /api/specs/{id}` 手动编辑修正。
