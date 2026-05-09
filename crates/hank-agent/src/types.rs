use serde::{Deserialize, Serialize};

/// Events emitted by the agent loop to the caller (SSE stream)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    TextDelta { text: String },
    ToolStart { id: String, name: String, input: String },
    ToolResult { id: String, content: String, is_error: bool },
    TurnComplete,
    Error { message: String },
}
