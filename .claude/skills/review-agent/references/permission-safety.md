# Permission & Safety 审查标准

## 权限防线模型

不同系统的权限层数不同，没有唯一正确答案，按需选用：

**Claude Code（规则驱动 + 可选 LLM 分类器）**
```
Layer 1: 权限模式（plan/default/acceptEdits/bypassPermissions）
Layer 2: Allow / Deny / Ask 规则（工具名 + 参数前缀匹配）
Layer 3: 人工确认（兜底，未匹配规则时询问用户）
可选增强: LLM 分类器（语义层判断，处理规则覆盖不到的边界，如 git status vs git push --force）
```

**OpenClaw（纯确定性五层，不依赖 LLM 判断）**
```
Layer 1: Tool Profile（按场景预选工具子集）
Layer 2: Allow / Deny 白名单（Provider 级粒度）
Layer 3: Owner-only 工具（高权限操作限管理员）
Layer 4: Exec Approval（执行类工具两阶段审批，60s 超时）
Layer 5: Workspace 路径边界（应用层路径校验，非 OS 沙箱）
```

> **注意**：
> - default 模式下未匹配规则的 Bash 命令是「询问用户」而非「自动拒绝」。只有明确在 denylist 中的才直接拒绝。
> - 「没有 LLM 分类器」不等于设计缺陷——OpenClaw 的五层全是确定性过滤，同样是生产级实现。
> - 评审时关注的是「是否有合理的分层」，而非「是否使用了某个特定技术」。

## 审查 Checklist

### 1. 工具风险分类 ✅

- [ ] 只读工具（read_file, grep, glob）：自动放行
- [ ] 写操作（write_file, edit）：需确认或 allowlist
- [ ] 破坏性操作（rm, git reset --hard）：强制确认
- [ ] 网络操作（fetch, curl）：视目标域决定

```typescript
enum ToolRisk {
  Safe = 'safe',           // 自动执行
  Moderate = 'moderate',   // allowlist 匹配则放行
  Dangerous = 'dangerous', // 必须人工确认
}
```

### 2. Allowlist / Denylist ✅

```typescript
interface PermissionRule {
  tool: string
  pattern?: string      // 参数匹配模式（glob/regex）
  action: 'allow' | 'deny' | 'ask'
}

// 示例
const rules: PermissionRule[] = [
  { tool: 'bash', pattern: 'npm test*', action: 'allow' },
  { tool: 'bash', pattern: 'rm -rf*', action: 'deny' },
  { tool: 'write_file', pattern: '/tmp/**', action: 'allow' },
  { tool: 'write_file', pattern: '/etc/**', action: 'deny' },
]
```

- [ ] 未匹配规则时的默认行为是否合理（default 模式 = ask 用户，不是自动 deny；只有明确 denylist 才拒绝）？
- [ ] 规则是否支持 glob/regex 匹配？
- [ ] 是否有「记住本次选择」机制避免重复确认？

### 3. 路径安全 ✅

- [ ] 文件操作是否限制在项目目录内？
- [ ] 是否防止了路径穿越（`../../etc/passwd`）？
- [ ] 是否阻止了对敏感文件的访问（`.env`, `credentials`）？

```typescript
import { resolve, relative } from 'node:path'
import { realpathSync } from 'node:fs'

function validatePath(path: string, projectRoot: string): boolean {
  // realpathSync 解析 symlink，防止通过软链接绕过
  const realRoot = realpathSync(projectRoot)
  let realPath: string
  try { realPath = realpathSync(resolve(projectRoot, path)) }
  catch { return false }  // 路径不存在也拒绝
  // relative 返回 '../' 开头说明路径在 root 之外
  const rel = relative(realRoot, realPath)
  return !rel.startsWith('..') && !rel.startsWith('/')
}
```

- [ ] 是否用 `realpathSync` 解析 symlink（防止软链接绕过）？
- [ ] 是否阻止访问不存在的路径？
- [ ] 是否阻止对敏感文件的访问（`.env`, `credentials`, `*.key`）？

### 4. Prompt Injection 防护 ✅

工具返回的内容可能包含恶意指令：

- [ ] 工具结果是否标记为「不可信数据」？
- [ ] 是否有指令注入检测（如检测 "ignore previous instructions"）？
- [ ] 文件内容是否与系统指令隔离？

### 5. 确认交互设计 ✅

避免「审批疲劳」：

- [ ] 是否支持批量审批（同类操作一次确认）？
- [ ] 是否有 session 级别的临时授权？
- [ ] 确认信息是否清晰展示操作内容和影响？
- [ ] 是否有超时自动拒绝？

## LLM 分类器（第五层：语义层权限判断）

规则无法覆盖所有边界情况（如 `git status` 安全 vs `git push --force` 高危），Claude Code 使用轻量 LLM 调用做语义判断：

```
规则匹配（静态）→ LLM 分类器（动态语义）→ 交互确认（兜底）
```

- 结合当前对话上下文理解命令意图
- 比 glob 规则（`Bash(git:*)` 全放行）更精细
- 代价：轻微额外延迟（Coding Agent 安全性值得付出）

## Mask Don't Remove 原则

不删除工具定义，而是标记不可用（通过 response prefill/logit masking 屏蔽输出概率）：

- 删除工具定义 → 改变 prompt 结构 → KV Cache 全部失效
- Mask 方案 → tools 列表不变 → Cache 命中率 ~95%（vs 动态增删的 ~20%）
- 工具名用统一前缀（`browser_*`、`shell_*`）方便按组 mask

## 权限模式参考（Claude Code）

| 模式 | 行为 |
|------|------|
| Ask Always | 每次工具调用都确认 |
| Auto-allow Safe | 只读自动放行，写操作确认 |
| Allowlist | 匹配规则放行，其余确认 |
| YOLO / Auto | 全部自动执行（仅限开发环境） |

## 反模式

| 反模式 | 问题 | 正确做法 |
|--------|------|----------|
| 无权限检查 | 模型可执行任意命令 | 分层权限 |
| 全部都要确认 | 审批疲劳，用户跳过审查 | 智能分级 |
| 信任工具返回内容 | Prompt Injection | 标记不可信 |
| 硬编码路径白名单 | 不灵活 | 配置化规则 |
| 无日志审计 | 出事无法追溯 | 记录所有操作 |

## 评分标准

- ⭐⭐⭐⭐⭐：明确分层（≥3 层）+ 路径边界（realpath）+ 审批疲劳优化 + 审计日志
- ⭐⭐⭐⭐：有操作分级和确认机制，路径校验安全，缺审计日志
- ⭐⭐⭐：有基本确认，无 allow/deny 规则，路径用 startsWith 校验
- ⭐⭐：只有简单的 yes/no 确认，无分级
- ⭐：无权限控制，生产环境危险
