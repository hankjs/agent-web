# Skill 设计的 10 个最佳实践

Skill 本质上是给模型使用的操作手册。写得好的 Skill 能显著提升模型输出的质量、稳定性和一致性；写得模糊、臃肿或缺少流程约束的 Skill，则很容易让模型跑偏。

这份文档整理了高质量 Skill 中反复出现的 10 个设计模式，适用于编写、重构或评审 Skill。

## 1. 渐进式加载：不要把所有内容都塞进 SKILL.md

核心原则：模型当前不需要的信息，就不要让它看到。

上下文窗口是公共资源。`SKILL.md` 会和系统提示词、对话历史、用户输入、其他 Skill 的元数据一起占用上下文。主文件越臃肿，留给实际任务的空间越少，关键指令也越容易被淹没。

推荐做法：

- `SKILL.md` 只保留触发后的主流程、导航和关键约束。
- 长 checklist、模板、示例、风格库、API 细节放到 `references/`。
- 在对应步骤中明确写出什么时候加载哪个 reference 文件。
- 尽量把 `SKILL.md` 控制在 500 行以内。

示例结构：

```text
code-review-expert/
├── SKILL.md
└── references/
    ├── solid-checklist.md
    ├── security-checklist.md
    ├── code-quality-checklist.md
    └── removal-plan.md
```

`SKILL.md` 中只需要在对应步骤写清楚：

```md
Step 2: Load references/solid-checklist.md and evaluate design issues.
Step 4: Load references/security-checklist.md and evaluate security risks.
```

反模式：把 API 文档、所有示例、FAQ、模板和完整检查清单全部塞进一个 2000 行的 `SKILL.md`。这会让模型在真正执行任务之前消耗大量上下文，并降低关键指令的权重。

## 2. 关键词轰炸 Description：决定 Skill 能不能被看见

`description` 是 Skill 最容易被低估的字段。它决定两件事：

- 模型什么时候自动触发这个 Skill。
- 用户搜索时能不能找到这个 Skill。

好的 `description` 不只是描述功能，而是覆盖用户可能说出的自然语言、任务类型、动作词和领域词。

差的写法：

```yaml
description: 代码审查工具
```

好的写法：

```yaml
description: "代码审查、PR review、检查代码质量、安全风险和架构问题。当用户说'帮我 review'、'检查代码'、'审查 PR'、'看看这段代码有没有问题'、'找 bug'、'检查安全问题'时使用。"
```

设计要点：

- 把触发关键词直接写进 `description`。
- 覆盖用户常用说法，而不是只写正式术语。
- 包含动作词：review、fix、检查、优化、生成、设计、分析。
- 包含对象词：PR、代码、组件、页面、dashboard、landing page、API。
- “何时使用”必须写在 frontmatter 的 `description` 中，不要只写在正文里。正文只有 Skill 触发后才会被加载，对触发本身没有帮助。

## 3. 工作流清单模式：给模型一条清晰的路

没有明确工作流的 Skill，模型很容易东一榔头西一棒子，重要问题和次要问题混在一起。高质量 Skill 通常会提供可追踪的 checklist，让模型按步骤执行。

示例：

```md
Copy this checklist and check off items as you complete them:

Skill Progress:

- [ ] Step 1: Setup and analyze
  - [ ] 1.1 Load preferences
  - [ ] 1.2 Analyze user input
  - [ ] 1.3 Check existing files
- [ ] Step 2: Confirm direction ⚠️ REQUIRED
- [ ] Step 3: Generate outline
- [ ] Step 4: Review outline (conditional)
- [ ] Step 5: Produce final output
- [ ] Step 6: Run pre-delivery checklist
```

设计要点：

- 用 `⚠️ REQUIRED` 标出不能跳过的关键节点。
- 用 `⛔ BLOCKING` 标出必须先完成的前置条件。
- 对复杂步骤拆子任务。
- 标出条件分支，例如 `(conditional)`。
- 工作流顺序要符合任务本身的专业逻辑。

例如 Code Review Skill 应该从宏观到微观：

1. 先理解改动范围和意图。
2. 再看架构和模块边界。
3. 再看安全、数据一致性和并发风险。
4. 最后看代码质量、命名、重复和清理空间。

好的 reviewer 不会一上来就抠命名规范，Skill 的流程也不应该这样设计。

## 4. 用脚本封装确定性操作

有些操作不需要模型每次重新推理，应该封装成脚本放进 `scripts/`。

适合脚本化的场景：

- 同一段代码或命令会被反复重写。
- 文件处理、格式转换、合并、拆分、校验等操作需要稳定可靠。
- 结果应该确定、可复现，而不是依赖模型临场发挥。
- 需要查询本地知识库、配置库、模板库。

示例结构：

```text
ui-ux-pro-max/
├── SKILL.md
├── scripts/
│   └── search.py
└── references/
    └── design-db.json
```

调用方式：

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "beauty spa" --domain color
```

好处：

- 模型只需要知道脚本用途和参数，不需要把脚本内容加载进上下文。
- 结果更稳定，减少幻觉。
- 复杂操作变成可测试、可维护的工具。

判断标准：如果模型每次都在重写相似代码，或者这件事需要确定性可靠性，就应该写成脚本。

## 5. 给模型该问的问题，而不是该找的答案

抽象指令容易得到泛泛而谈的输出。好的 Skill 会把检查项写成具体问题，让模型带着问题分析。

差的写法：

```md
检查代码是否违反单一职责原则。
```

好的写法：

```md
问自己：这个模块有几个不同的修改理由？
如果答案超过一个，它可能违反了单一职责原则。
```

更多例子：

- 竞态条件：两个请求同时打到这段代码会怎么样？
- 边界条件：如果这个值是 `null`、`0`、空字符串或空数组，会怎样？
- 权限检查：检查权限和实际操作之间，状态有没有可能被改变？
- 数据一致性：部分写入成功、部分失败时，系统会处于什么状态？
- 错误处理：这个异常被吞掉后，调用方还能知道失败了吗？

模型擅长“带着问题找答案”。具体问题会迫使它定位代码、分析路径、给出证据，而不是停留在抽象建议。

## 6. 确认节点：不要让模型自作主张

涉及生成、修改、删除、批量执行或用户偏好的 Skill，必须设计确认节点。确认节点的作用是让模型在关键操作前停下来，避免一路自动执行到底。

常见确认节点：

- 首次使用时确认偏好设置。
- 生成前确认风格、受众、范围、数量、语言。
- 修改代码前确认修复范围。
- 删除或迁移前确认影响面。
- 多阶段任务中确认 outline、prompt、计划或预览结果。

示例：

```md
Step 2: Confirm options ⚠️ REQUIRED

Before generating final output, ask the user to confirm:

- Type
- Style
- Audience
- Output length
- Whether to review intermediate results

Do not continue unless the user confirms, except when `--quick` is provided.
```

Code Review Skill 可以采用“先 review，再确认是否修复”的模式：

```md
After reporting findings, ask the user how to proceed:

- Fix all findings
- Fix only P0/P1 findings
- Fix selected findings
- Do not modify code
```

这样保留了 review 的核心价值：先让用户理解问题，再决定是否修改。

## 7. Pre-Delivery Checklist：交付前的最后一道防线

输出型 Skill 应该在最后设置交付前检查清单。它适用于生成代码、设计、文档、配置、报告等场景。

关键要求：每一条都必须具体、可检查。

差的写法：

```md
- [ ] 确保质量很好
- [ ] 确保可访问性良好
- [ ] 确保代码优雅
```

好的写法：

```md
## Pre-Delivery Checklist

### Visual Quality

- [ ] No emojis used as icons; use SVG or icon library instead
- [ ] All icons come from a consistent icon set
- [ ] Hover states do not cause layout shift

### Interaction

- [ ] Clickable elements use pointer cursor
- [ ] Transitions are smooth and between 150-300ms

### Accessibility

- [ ] Images have alt text
- [ ] Form inputs have labels
- [ ] Reduced-motion preferences are respected
```

Code Review Skill 也可以用优先级分级作为交付质量控制：

| Level | Meaning | Handling |
| --- | --- | --- |
| P0 | 严重问题 | 必须阻止合并 |
| P1 | 高风险问题 | 应在合并前修复 |
| P2 | 中等问题 | 建议建 follow-up |
| P3 | 低优问题 | 可选优化 |

这种分级能避免模型把所有问题说成同等重要。

## 8. 参数系统：让 Skill 变成可配置工具

高质量 Skill 不应该只有一种固定执行方式。参数系统可以让用户按需控制范围、阶段、风格和执行深度。

示例：

```bash
/slide-deck content.md --style sketch-notes --audience executives --lang zh --slides 10
/slide-deck content.md --outline-only
/slide-deck content.md --prompts-only
/slide-deck slide-deck/topic/ --images-only
/slide-deck slide-deck/topic/ --regenerate 3
```

常见参数类型：

- 范围控制：`--slides 10`、`--files src/`、`--regenerate 3`
- 阶段控制：`--outline-only`、`--prompts-only`、`--images-only`
- 风格控制：`--style`、`--palette`、`--rendering`
- 确认控制：`--quick`、`--no-confirm`
- 输入增强：`--ref style-ref.png`

在 `SKILL.md` 中说明解析规则：

```md
## Options

| Option | Description |
| --- | --- |
| `--style <name>` | Visual style |
| `--quick` | Skip confirmation and use defaults |
| `--ref <files>` | Use reference files or images |
| `--regenerate <n>` | Regenerate a specific item |
```

同时在 frontmatter 中加入 `argument-hint`：

```yaml
argument-hint: "[content] [--style name] [--quick] [--ref files]"
```

参数系统的价值是让 Skill 支持局部重做、分阶段执行和用户偏好，而不是每次都从头到尾跑一遍。

## 9. References 分类组织：不要一股脑堆文件

当 `references/` 文件变多后，组织方式会直接影响模型能不能精确加载需要的信息。

推荐按领域分类：

```text
cover-image/
├── SKILL.md
└── references/
    ├── palettes/
    │   ├── warm.md
    │   └── cool.md
    ├── renderings/
    │   ├── flat-vector.md
    │   └── hand-drawn.md
    ├── config/
    │   ├── preferences-schema.md
    │   └── first-time-setup.md
    ├── workflow/
    │   ├── confirm-options.md
    │   └── prompt-template.md
    ├── auto-selection.md
    ├── compatibility.md
    └── types.md
```

使用方式：

- 用户选择 `warm` 配色时，只加载 `references/palettes/warm.md`。
- 用户选择 `hand-drawn` 渲染时，只加载 `references/renderings/hand-drawn.md`。
- 首次配置时，才加载 `references/config/first-time-setup.md`。

如果 Skill 面向多个业务域，也可以这样组织：

```text
bigquery-skill/
├── SKILL.md
└── references/
    ├── finance.md
    ├── sales.md
    └── product.md
```

如果 Skill 支持多个云厂商：

```text
cloud-deploy/
├── SKILL.md
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```

组织原则：

- 按领域、平台、风格、阶段或配置类型分类。
- `SKILL.md` 必须清楚说明什么时候读哪个文件。
- Reference 文件不要靠模型猜路径。
- 嵌套不宜过深，通常一层分类目录就够了。

## 10. CLI 工具 + Skill：MCP 的轻量替代方案

有些能力不一定要做成 MCP Server。可以把复杂能力封装成 CLI，再用 Skill 教模型怎么调用它。

示例：

```bash
agent-browser open https://example.com
agent-browser snapshot -i
agent-browser click @e1
agent-browser fill @e2 "text"
```

这种模式的核心逻辑：

- CLI 负责复杂协议、状态管理和确定性执行。
- Skill 负责告诉模型什么时候调用、怎么调用、如何解释结果。
- 模型通过命令行使用能力，而不是把大量工具 schema 塞进上下文。

`SKILL.md` 中可以只保留命令参考：

```md
## Commands

- `agent-browser open <url>`: Open a page.
- `agent-browser snapshot -i`: Print interactive element snapshot.
- `agent-browser click <element_id>`: Click an element.
- `agent-browser fill <element_id> <text>`: Fill input text.
```

如果运行环境支持工具权限约束，可以限制 Skill 只能调用指定 CLI：

```yaml
allowed-tools: Bash(agent-browser:*)
```

适合这种模式的场景：

- 浏览器自动化。
- 文件格式转换。
- 本地搜索或索引查询。
- 与内部系统交互。
- 复杂但稳定的领域操作。

设计判断：如果你只是想给模型增加一种可执行能力，优先考虑“CLI 工具 + Skill”。只有在确实需要长连接、多工具协作、复杂资源协议或外部系统暴露时，再考虑 MCP。

## 快速检查表

写完 Skill 后，可以用这份清单自检：

- [ ] `description` 覆盖了用户可能说出的自然语言关键词。
- [ ] `SKILL.md` 只保留主流程、导航和关键约束。
- [ ] 大块资料已经拆到 `references/`，并说明何时加载。
- [ ] 工作流有明确步骤、关键节点和条件分支。
- [ ] 确定性操作已经封装成 `scripts/` 或 CLI。
- [ ] 分析项以具体问题呈现，而不是抽象口号。
- [ ] 关键生成、修改、删除操作前有确认节点。
- [ ] 输出前有具体、可验证的 pre-delivery checklist。
- [ ] 参数系统支持范围、阶段、风格或确认控制。
- [ ] references 分类清晰，模型不需要猜该读哪个文件。

## 总结

高质量 Skill 的共同点不是“写得更长”，而是更会分层：

- 用 `description` 解决触发问题。
- 用 `SKILL.md` 编排流程。
- 用 `references/` 承载细节。
- 用 `scripts/` 和 CLI 执行确定性操作。
- 用 checklist、确认节点和交付检查保证稳定性。

把 Skill 当成给模型的 SOP 来设计，而不是一篇随手写的 Markdown，输出质量会完全不同。
