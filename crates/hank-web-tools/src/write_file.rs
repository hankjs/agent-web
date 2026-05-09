use crate::{Tool, ToolOutput};
use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::fs;

pub struct WriteFileTool {
    work_dir: Option<String>,
}

impl WriteFileTool {
    pub fn new(work_dir: Option<String>) -> Self {
        Self { work_dir }
    }

    fn resolve_path(&self, path: &str) -> String {
        if path.starts_with('/') {
            return path.to_string();
        }
        match &self.work_dir {
            Some(dir) => format!("{}/{}", dir.trim_end_matches('/'), path),
            None => path.to_string(),
        }
    }
}

#[async_trait]
impl Tool for WriteFileTool {
    fn name(&self) -> &str {
        "write_file"
    }

    fn description(&self) -> &str {
        "Write content to a file. Creates the file if it doesn't exist, or overwrites it if it does. Parent directories are created automatically."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "The file path to write (absolute or relative to work_dir)"
                },
                "content": {
                    "type": "string",
                    "description": "The content to write to the file"
                }
            },
            "required": ["path", "content"]
        })
    }

    async fn execute(&self, input: Value) -> Result<ToolOutput> {
        let path = input["path"].as_str().unwrap_or_default();
        if path.is_empty() {
            return Ok(ToolOutput {
                content: "Error: path is required".to_string(),
                is_error: true,
            });
        }

        let content = input["content"].as_str().unwrap_or_default();
        let resolved = self.resolve_path(path);

        // Create parent directories if needed
        if let Some(parent) = std::path::Path::new(&resolved).parent() {
            if let Err(e) = fs::create_dir_all(parent).await {
                return Ok(ToolOutput {
                    content: format!("Error creating directories: {e}"),
                    is_error: true,
                });
            }
        }

        match fs::write(&resolved, content).await {
            Ok(()) => {
                let lines = content.lines().count();
                Ok(ToolOutput {
                    content: format!("Successfully wrote {lines} lines to {path}"),
                    is_error: false,
                })
            }
            Err(e) => Ok(ToolOutput {
                content: format!("Error writing file: {e}"),
                is_error: true,
            }),
        }
    }
}
