use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Unified event types emitted to the frontend via Tauri events.
/// These map to both remote (Server SSE) and local (ACP) event sources.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AcpEvent {
    #[serde(rename = "text_delta")]
    TextDelta { content: String },

    #[serde(rename = "tool_use")]
    ToolUse {
        tool_call_id: String,
        tool_name: String,
        input: Value,
    },

    #[serde(rename = "tool_result")]
    ToolResult {
        tool_call_id: String,
        output: Value,
        is_error: bool,
    },

    #[serde(rename = "done")]
    Done { stop_reason: String },

    #[serde(rename = "error")]
    Error { message: String },
}

/// Payload emitted via Tauri event system to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpEventPayload {
    pub session_id: String,
    pub event: AcpEvent,
}
