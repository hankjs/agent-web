use crate::{Tool, ToolOutput};
use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::time::Duration;

const DEFAULT_MAX_BYTES: usize = 200_000;
const FETCH_TIMEOUT_SECS: u64 = 30;

pub struct WebFetchTool;

impl WebFetchTool {
    pub fn new() -> Self {
        Self
    }

    /// 简单 HTML 标签剥离
    fn strip_html(html: &str) -> String {
        let mut result = String::with_capacity(html.len());
        let mut in_tag = false;
        let mut in_script = false;
        let mut in_style = false;

        let lower = html.to_lowercase();
        let chars: Vec<char> = html.chars().collect();
        let lower_chars: Vec<char> = lower.chars().collect();

        let mut i = 0;
        while i < chars.len() {
            if !in_tag && chars[i] == '<' {
                in_tag = true;
                // 检查是否进入 script/style
                let remaining: String = lower_chars[i..].iter().take(10).collect();
                if remaining.starts_with("<script") {
                    in_script = true;
                } else if remaining.starts_with("<style") {
                    in_style = true;
                } else if remaining.starts_with("</script") {
                    in_script = false;
                } else if remaining.starts_with("</style") {
                    in_style = false;
                }
            } else if in_tag && chars[i] == '>' {
                in_tag = false;
            } else if !in_tag && !in_script && !in_style {
                result.push(chars[i]);
            }
            i += 1;
        }

        // 压缩连续空白行
        let lines: Vec<&str> = result.lines().collect();
        let mut compressed = String::new();
        let mut blank_count = 0;
        for line in lines {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                blank_count += 1;
                if blank_count <= 2 {
                    compressed.push('\n');
                }
            } else {
                blank_count = 0;
                compressed.push_str(trimmed);
                compressed.push('\n');
            }
        }

        compressed
    }
}

#[async_trait]
impl Tool for WebFetchTool {
    fn name(&self) -> &str {
        "web_fetch"
    }

    fn description(&self) -> &str {
        "Fetch content from a URL. Returns the page text with HTML tags stripped. \
         Useful for reading documentation, API references, or web pages."
    }

    fn timeout(&self) -> Duration {
        Duration::from_secs(FETCH_TIMEOUT_SECS)
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL to fetch"
                },
                "max_bytes": {
                    "type": "integer",
                    "description": "Maximum bytes to return (default 200000)"
                }
            },
            "required": ["url"]
        })
    }

    async fn execute(&self, input: Value) -> Result<ToolOutput> {
        let url = input["url"].as_str().unwrap_or_default();
        if url.is_empty() {
            return Ok(ToolOutput {
                content: "Error: url is required".to_string(),
                is_error: true,
            });
        }

        let max_bytes = input["max_bytes"]
            .as_u64()
            .map(|v| v as usize)
            .unwrap_or(DEFAULT_MAX_BYTES);

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
            .redirect(reqwest::redirect::Policy::limited(5))
            .user_agent("HankAgent/1.0")
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to build HTTP client: {e}"))?;

        let response = match client.get(url).send().await {
            Ok(r) => r,
            Err(e) => {
                return Ok(ToolOutput {
                    content: format!("Error fetching URL: {e}"),
                    is_error: true,
                });
            }
        };

        let status = response.status();
        if !status.is_success() {
            return Ok(ToolOutput {
                content: format!("Error: HTTP {status}"),
                is_error: true,
            });
        }

        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let body = match response.text().await {
            Ok(t) => t,
            Err(e) => {
                return Ok(ToolOutput {
                    content: format!("Error reading response body: {e}"),
                    is_error: true,
                });
            }
        };

        // 如果是 HTML，剥离标签
        let text = if content_type.contains("html") {
            Self::strip_html(&body)
        } else {
            body
        };

        // 截断到 max_bytes
        let output = if text.len() > max_bytes {
            format!(
                "{}\n\n... [truncated, {} bytes total]",
                &text[..max_bytes],
                text.len()
            )
        } else {
            text
        };

        Ok(ToolOutput {
            content: output,
            is_error: false,
        })
    }
}
