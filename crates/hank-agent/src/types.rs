use serde::{Deserialize, Serialize};

/// Events emitted by the agent loop to the caller (WebSocket handler)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    TextDelta { text: String },
    ToolStart { id: String, name: String, input: String },
    ToolResult { id: String, content: String, is_error: bool },
    TurnComplete,
    Error { message: String },
}

/// Inbound commands from the client
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    SendMessage {
        content: String,
        session_id: String,
        provider: Option<String>,
        model: Option<String>,
    },
    Cancel,
}
