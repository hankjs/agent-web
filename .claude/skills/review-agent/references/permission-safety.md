# Permission & Safety 审查标准

## 四层防线模型

```
Layer 1: 工具分类（静态标注）
Layer 2: 规则过滤（allowlist / denylist）
Layer 3: 人工确认（交互式审批）
Layer 4: 沙箱隔离（运行时限制）
```

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

- [ ] 是否有默认 deny 策略（未匹配规则时拒绝）？
- [ ] 规则是否支持 glob/regex 匹配？
- [ ] 是否有「记住本次选择」机制避免重复确认？

### 3. 路径安全 ✅

- [ ] 文件操作是否限制在项目目录内？
- [ ] 是否防止了路径穿越（`../../etc/passwd`）？
- [ ] 是否阻止了对敏感文件的访问（`.env`, `credentials`）？

```typescript
function validatePath(path: string, projectRoot: string): boolean {
  const resolved = resolve(projectRoot, path)
  return resolved.startsWith(projectRoot)  // 防止路径穿越
}
```

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

- ⭐⭐⭐⭐⭐：四层防线完整 + 审批疲劳优化 + 审计日志
- ⭐⭐⭐⭐：有分类和确认机制，缺沙箱
- ⭐⭐⭐：有基本确认，无 allowlist
- ⭐⭐：只有简单的 yes/no 确认
- ⭐：无权限控制，生产环境危险
