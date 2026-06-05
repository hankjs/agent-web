use serde_json::Value;

/// 工具风险等级
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolRisk {
    /// 只读操作，无副作用
    Safe,
    /// 文件写入等可逆操作
    Moderate,
    /// Shell 执行、危险 git 操作等
    Dangerous,
}

/// 权限模式（对齐 Codex sandbox 三档与 Claude permission-mode，FR-PERM-1）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionMode {
    /// 仅探查：只允许只读工具
    ReadOnly,
    /// 可写根内编辑：写工具放行，shell/危险操作需审批
    WorkspaceWrite,
    /// 单次命令/工具经批准后执行
    Escalated,
    /// 仅受信自动化环境显式启用：全部放行（黑名单仍生效）
    Unrestricted,
}

impl Default for PermissionMode {
    fn default() -> Self {
        Self::WorkspaceWrite
    }
}

impl PermissionMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ReadOnly => "read-only",
            Self::WorkspaceWrite => "workspace-write",
            Self::Escalated => "escalated",
            Self::Unrestricted => "unrestricted",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "read-only" | "read_only" | "readonly" => Self::ReadOnly,
            "escalated" => Self::Escalated,
            "unrestricted" => Self::Unrestricted,
            _ => Self::WorkspaceWrite,
        }
    }
}

/// 权限检查结果
#[derive(Debug, Clone)]
pub enum PermissionDecision {
    /// 允许执行
    Allow,
    /// 拒绝执行，附带原因
    Deny(String),
    /// 需要用户确认
    NeedApproval(String),
}

/// 权限配置
#[derive(Debug, Clone)]
pub struct PermissionConfig {
    /// 权限模式
    pub mode: PermissionMode,
    /// 允许写入的路径前缀
    pub sandbox_paths: Vec<String>,
    /// Shell 额外黑名单命令
    pub blocked_commands: Vec<String>,
    /// 自动放行的工具名
    pub auto_approve_tools: Vec<String>,
    /// 预授权的命令前缀（如 "npm test"、"cargo test"，FR-PERM-8）
    pub approved_prefixes: Vec<String>,
}

impl Default for PermissionConfig {
    fn default() -> Self {
        Self {
            mode: PermissionMode::default(),
            sandbox_paths: Vec::new(),
            blocked_commands: vec![
                "rm -rf /".to_string(),
                "mkfs".to_string(),
                "dd if=/dev".to_string(),
                ":(){ :|:& };:".to_string(),
                "chmod -R 777 /".to_string(),
                "curl | sh".to_string(),
                "wget | sh".to_string(),
            ],
            auto_approve_tools: vec![
                "read_file".to_string(),
                "search".to_string(),
                "list_directory".to_string(),
            ],
            approved_prefixes: Vec::new(),
        }
    }
}

/// 权限守卫
pub struct PermissionGuard {
    config: PermissionConfig,
}

impl PermissionGuard {
    pub fn new(config: PermissionConfig) -> Self {
        Self { config }
    }

    pub fn with_defaults() -> Self {
        Self::new(PermissionConfig::default())
    }

    /// 以指定权限模式构建
    pub fn with_mode(mode: PermissionMode) -> Self {
        let mut config = PermissionConfig::default();
        config.mode = mode;
        Self::new(config)
    }

    pub fn mode(&self) -> PermissionMode {
        self.config.mode
    }

    /// 检查写路径是否落在 sandbox 内（FR-PERM-4）。
    /// sandbox_paths 为空时回退到 work_dir 前缀。
    fn path_in_sandbox(&self, path: &str, work_dir: &str) -> bool {
        let resolved = if path.starts_with('/') {
            path.to_string()
        } else {
            format!("{}/{}", work_dir.trim_end_matches('/'), path)
        };
        // 拒绝路径穿越
        if resolved.contains("/../") || resolved.ends_with("/..") {
            return false;
        }
        let roots: Vec<String> = if self.config.sandbox_paths.is_empty() {
            if work_dir.is_empty() {
                return true; // 未配置 work_dir 时不做路径限制
            }
            vec![work_dir.trim_end_matches('/').to_string()]
        } else {
            self.config.sandbox_paths.clone()
        };
        roots.iter().any(|prefix| resolved.starts_with(prefix.trim_end_matches('/')))
    }

    /// 检查命令是否命中预授权前缀（FR-PERM-8）
    fn matches_approved_prefix(&self, command: &str) -> bool {
        let trimmed = command.trim();
        self.config
            .approved_prefixes
            .iter()
            .any(|p| trimmed.starts_with(p.trim()))
    }

    /// 检查工具执行权限
    pub fn check(
        &self,
        tool_name: &str,
        input: &Value,
        risk: ToolRisk,
        work_dir: &str,
    ) -> PermissionDecision {
        // 1. Safe 工具与自动放行工具直接放行（任何模式）
        if risk == ToolRisk::Safe || self.config.auto_approve_tools.contains(&tool_name.to_string()) {
            return PermissionDecision::Allow;
        }

        // 2. Shell 黑名单优先于一切：命中直接 Deny（即使 unrestricted）
        if tool_name == "shell" {
            if let Some(cmd) = input["command"].as_str() {
                let lower = cmd.to_lowercase();
                for blocked in &self.config.blocked_commands {
                    if lower.contains(&blocked.to_lowercase()) {
                        return PermissionDecision::Deny(format!(
                            "Command contains blocked pattern: '{blocked}'"
                        ));
                    }
                }
            }
        }

        // 3. ReadOnly 模式：拒绝所有非只读工具
        if self.config.mode == PermissionMode::ReadOnly {
            return PermissionDecision::Deny(format!(
                "Tool '{tool_name}' is not allowed in read-only mode"
            ));
        }

        // 4. 写路径 sandbox 校验（write_file / str_replace）
        if tool_name == "write_file" || tool_name == "str_replace" {
            if let Some(path) = input["path"].as_str() {
                if !self.path_in_sandbox(path, work_dir) {
                    return PermissionDecision::Deny(format!(
                        "Path '{}' is outside allowed sandbox/workspace roots",
                        path
                    ));
                }
            }
        }

        // 5. Unrestricted 模式：黑名单外全部放行
        if self.config.mode == PermissionMode::Unrestricted {
            return PermissionDecision::Allow;
        }

        // 6. 预授权命令前缀放行（FR-PERM-8）
        if tool_name == "shell" {
            if let Some(cmd) = input["command"].as_str() {
                if self.matches_approved_prefix(cmd) {
                    return PermissionDecision::Allow;
                }
            }
        }

        // 7. Escalated 模式：Dangerous 工具需要单次审批
        if self.config.mode == PermissionMode::Escalated && risk == ToolRisk::Dangerous {
            let reason = match tool_name {
                "shell" => {
                    let cmd = input["command"].as_str().unwrap_or("<unknown>");
                    let preview: String = cmd.chars().take(100).collect();
                    format!("Shell command execution: {}", preview)
                }
                "git" => {
                    let args = input["args"].as_str().unwrap_or("<unknown>");
                    format!("Git operation: {}", args)
                }
                _ => format!("Dangerous tool: {tool_name}"),
            };
            return PermissionDecision::NeedApproval(reason);
        }

        // 8. workspace-write 模式：Moderate/Dangerous 工具在通过 sandbox/黑名单后放行。
        //    （workspace-write 授予工作区内自主执行能力，对齐 Codex sandbox 语义）
        PermissionDecision::Allow
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn guard(mode: PermissionMode) -> PermissionGuard {
        let mut cfg = PermissionConfig::default();
        cfg.mode = mode;
        cfg.sandbox_paths = vec!["/work".to_string()];
        PermissionGuard::new(cfg)
    }

    #[test]
    fn test_blocked_command_always_denied() {
        // 危险命令在任何模式下都被拒绝（FR-PERM-3）
        for mode in [PermissionMode::WorkspaceWrite, PermissionMode::Unrestricted] {
            let g = guard(mode);
            let d = g.check("shell", &json!({"command": "rm -rf /"}), ToolRisk::Dangerous, "/work");
            assert!(matches!(d, PermissionDecision::Deny(_)), "mode {:?}", mode);
        }
    }

    #[test]
    fn test_read_only_denies_writes() {
        let g = guard(PermissionMode::ReadOnly);
        let d = g.check("write_file", &json!({"path": "a.txt"}), ToolRisk::Moderate, "/work");
        assert!(matches!(d, PermissionDecision::Deny(_)));
        // 只读工具仍然放行
        let d2 = g.check("read_file", &json!({"path": "a.txt"}), ToolRisk::Safe, "/work");
        assert!(matches!(d2, PermissionDecision::Allow));
    }

    #[test]
    fn test_write_outside_sandbox_denied() {
        let g = guard(PermissionMode::WorkspaceWrite);
        let d = g.check("write_file", &json!({"path": "/etc/passwd"}), ToolRisk::Moderate, "/work");
        assert!(matches!(d, PermissionDecision::Deny(_)));
        // sandbox 内允许
        let d2 = g.check("write_file", &json!({"path": "/work/a.txt"}), ToolRisk::Moderate, "/work");
        assert!(matches!(d2, PermissionDecision::Allow));
    }

    #[test]
    fn test_path_traversal_denied() {
        let g = guard(PermissionMode::WorkspaceWrite);
        let d = g.check("write_file", &json!({"path": "../../etc/passwd"}), ToolRisk::Moderate, "/work");
        assert!(matches!(d, PermissionDecision::Deny(_)));
    }

    #[test]
    fn test_dangerous_needs_approval_in_escalated() {
        let g = guard(PermissionMode::Escalated);
        let d = g.check("shell", &json!({"command": "ls -la"}), ToolRisk::Dangerous, "/work");
        assert!(matches!(d, PermissionDecision::NeedApproval(_)));
    }

    #[test]
    fn test_workspace_write_allows_shell() {
        // workspace-write 模式下普通 shell 自主执行（对齐 Codex sandbox 语义）
        let g = guard(PermissionMode::WorkspaceWrite);
        let d = g.check("shell", &json!({"command": "ls -la"}), ToolRisk::Dangerous, "/work");
        assert!(matches!(d, PermissionDecision::Allow));
    }

    #[test]
    fn test_approved_prefix_allows_shell() {
        let mut cfg = PermissionConfig::default();
        cfg.mode = PermissionMode::WorkspaceWrite;
        cfg.approved_prefixes = vec!["cargo test".to_string()];
        let g = PermissionGuard::new(cfg);
        let d = g.check("shell", &json!({"command": "cargo test --workspace"}), ToolRisk::Dangerous, "/work");
        assert!(matches!(d, PermissionDecision::Allow));
    }

    #[test]
    fn test_unrestricted_allows_normal_shell() {
        let g = guard(PermissionMode::Unrestricted);
        let d = g.check("shell", &json!({"command": "ls -la"}), ToolRisk::Dangerous, "/work");
        assert!(matches!(d, PermissionDecision::Allow));
    }
}
