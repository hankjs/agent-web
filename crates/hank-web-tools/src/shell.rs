use crate::{Tool, ToolOutput};
use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::time::Duration;
use tokio::process::Command;
use tracing::warn;

const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_OUTPUT_BYTES: usize = 100_000;

const BLOCKED_COMMANDS: &[&str] = &[
    "rm -rf /",
    "mkfs",
    "dd if=/dev/zero",
    ":(){ :|:& };:",
    "shutdown",
    "reboot",
    "halt",
    "poweroff",
];

pub struct ShellTool;

impl ShellTool {
    pub fn new() -> Self {
        Self
    }

    fn is_blocked(command: &str) -> bool {
        let lower = command.to_lowercase();
        BLOCKED_COMMANDS.iter().any(|b| lower.contains(b))
    }

    fn truncate_output(output: &str) -> String {
        if output.len() <= MAX_OUTPUT_BYTES {
            return output.to_string();
        }
        let half = MAX_OUTPUT_BYTES / 2;
        let start = &output[..half];
        let end = &output[output.len() - half..];
        format!("{start}\n\n... [output truncated, {len} bytes total] ...\n\n{end}", len = output.len())
    }
}

#[async_trait]
impl Tool for ShellTool {
    fn name(&self) -> &str {
        "shell"
    }

    fn description(&self) -> &str {
        "Execute a shell command and return its output. Commands have a timeout and output size limit."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to execute"
                },
                "timeout_secs": {
                    "type": "integer",
                    "description": "Timeout in seconds (default 30)"
                }
            },
            "required": ["command"]
        })
    }

    async fn execute(&self, input: Value) -> Result<ToolOutput> {
        let command = input["command"]
            .as_str()
            .unwrap_or_default()
            .to_string();

        if command.is_empty() {
            return Ok(ToolOutput {
                content: "Error: command is required".to_string(),
                is_error: true,
            });
        }

        if Self::is_blocked(&command) {
            warn!("Blocked dangerous command: {command}");
            return Ok(ToolOutput {
                content: "Error: this command is blocked for safety reasons".to_string(),
                is_error: true,
            });
        }

        let timeout_secs = input["timeout_secs"]
            .as_u64()
            .unwrap_or(DEFAULT_TIMEOUT_SECS);

        let result = tokio::time::timeout(
            Duration::from_secs(timeout_secs),
            Command::new("sh").arg("-c").arg(&command).output(),
        )
        .await;

        match result {
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let code = output.status.code().unwrap_or(-1);

                let combined = if stderr.is_empty() {
                    format!("Exit code: {code}\n{stdout}")
                } else {
                    format!("Exit code: {code}\nSTDOUT:\n{stdout}\nSTDERR:\n{stderr}")
                };

                Ok(ToolOutput {
                    content: Self::truncate_output(&combined),
                    is_error: code != 0,
                })
            }
            Ok(Err(e)) => Ok(ToolOutput {
                content: format!("Error executing command: {e}"),
                is_error: true,
            }),
            Err(_) => Ok(ToolOutput {
                content: format!("Error: command timed out after {timeout_secs}s"),
                is_error: true,
            }),
        }
    }
}
