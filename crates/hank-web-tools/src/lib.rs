pub mod ask_user;
pub mod explore_tools;
pub mod generate_tools;
pub mod read_file;
pub mod search;
pub mod shell;
pub mod spec_tools;
pub mod write_file;

use anyhow::Result;
use async_trait::async_trait;
use serde_json::Value;

#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn input_schema(&self) -> Value;
    async fn execute(&self, input: Value) -> Result<ToolOutput>;
}

#[derive(Debug, Clone)]
pub struct ToolOutput {
    pub content: String,
    pub is_error: bool,
}
