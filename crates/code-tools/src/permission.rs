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
    /// 允许写入的路径前缀
    pub sandbox_paths: Vec<String>,
    /// Shell 额外黑名单命令
    pub blocked_commands: Vec<String>,
    /// 自动放行的工具名
    pub auto_approve_tools: Vec<String>,
}

impl Default for PermissionConfig {
    fn default() -> Self {
        Self {
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

    /// 检查工具执行权限
    pub fn check(
        &self,
        tool_name: &str,
        input: &Value,
        risk: ToolRisk,
        work_dir: &str,
    ) -> PermissionDecision {
        // 自动放行的工具
        if self.config.auto_approve_tools.contains(&tool_name.to_string()) {
            return PermissionDecision::Allow;
        }

        // Safe 工具直接放行
        if risk == ToolRisk::Safe {
            return PermissionDecision::Allow;
        }

        // 检查 shell 命令黑名单
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

        // 检查文件写入路径是否在 sandbox 内
        if (tool_name == "write_file" || tool_name == "str_replace") && !self.config.sandbox_paths.is_empty() {
            if let Some(path) = input["path"].as_str() {
                let resolved = if path.starts_with('/') {
                    path.to_string()
                } else {
                    format!("{}/{}", work_dir.trim_end_matches('/'), path)
                };

                let in_sandbox = self.config.sandbox_paths.iter().any(|prefix| {
                    resolved.starts_with(prefix)
                });

                if !in_sandbox {
                    return PermissionDecision::Deny(format!(
                        "Path '{}' is outside allowed sandbox paths",
                        resolved
                    ));
                }
            }
        }

        // Dangerous 工具需要审批（但不阻止，由调用方决定是否走 ask_user）
        if risk == ToolRisk::Dangerous {
            let reason = match tool_name {
                "shell" => {
                    let cmd = input["command"].as_str().unwrap_or("<unknown>");
                    format!("Shell command execution: {}", &cmd[..cmd.len().min(100)])
                }
                "git" => {
                    let args = input["args"].as_str().unwrap_or("<unknown>");
                    format!("Git operation: {}", args)
                }
                _ => format!("Dangerous tool: {tool_name}"),
            };
            return PermissionDecision::NeedApproval(reason);
        }

        // Moderate 工具默认允许
        PermissionDecision::Allow
    }
}
