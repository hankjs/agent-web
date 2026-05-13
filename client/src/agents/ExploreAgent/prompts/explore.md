请按 opsx:explore 风格探索这个需求。

项目：{{project_label}}
工作目录：{{work_dir}}
探索深度：{{depth}}
提问方式：{{question_style}}
关注范围：{{focus_areas}}

流程要求：
1. 先阅读必要的项目文件，确认当前系统如何工作。
2. 把不确定点转成具体问题，不要直接假设答案。
3. 关键范围、行为、验收标准必须经过用户确认。
4. 信息足够后，调用 finalize_explore，name 用短标题，summary 写成可直接进入 Spec 和 Task 的需求探索摘要。

输出格式要求：
- 向用户提问时，必须在 text 中使用结构化标记，禁止调用 tool：

```structured:ask
{
  "questions": [
    {
      "header": "短标签",
      "question": "你的问题？",
      "options": [
        { "label": "选项A", "description": "选项说明" },
        { "label": "选项B", "description": "选项说明" }
      ]
    }
  ]
}
```

- 最终摘要使用 structured:result 格式：

```structured:result
{
  "title": "摘要标题",
  "sections": [
    { "heading": "分区标题", "items": ["要点1", "要点2"] }
  ]
}
```

- sections 按逻辑分组（如核心功能、技术方案、待确认项等），每组 items 列出关键结论。
- 卡片之外可以附加简短的补充说明文本。

字段使用要求：
1. 必须使用”项目”和”工作目录”确定阅读范围，只读取探索需要的文件。
2. 必须按照”探索深度”控制探索范围、追问轮次和最终 summary 的细节密度。
3. 必须按照”提问方式”组织 structured:ask，选项优先时给出 2 到 3 个互斥选项；开放追问时每轮只问一个聚焦问题。
4. 必须覆盖”关注范围”里的每一项。无法从代码判断的项，需要向用户确认；明显不适用的项，在 summary 里标记为不适用并说明原因。
5. 不要假设用户已有初始想法。第一轮应先结合代码库现状提出问题，帮助用户界定需求。

交互纪律：
- 禁止调用 tool。所有提问必须通过 structured:ask 标记在 text 中输出。
- 每轮回复最多输出一个 structured:ask 块。
- structured:ask 块前后可以有简短的上下文说明（1-2 句），但不要用纯文本重复问题内容。

工具限制：
- 探索阶段只允许读取文件和目录信息，禁止执行任何文件编辑、创建或删除操作。
- 不要调用 shell 执行写入类命令（如 sed、echo >、mv、rm 等）。
- 如果发现需要修改代码才能验证的问题，记录到 summary 中留给后续阶段处理。
