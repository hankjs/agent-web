use crate::provider_registry;
use crate::response::{self as R};
use crate::AppState;
use axum::{
    extract::State,
    response::{
        sse::{Event, Sse},
        IntoResponse,
    },
    Json,
};
use futures::StreamExt;
use hank_provider::{CompletionRequest, ContentBlock, Message, Role, StreamEvent, ToolDefinition};
use hank_web_tools::{read_file::ReadFileTool, search::SearchTool, Tool};
use serde::Deserialize;
use std::convert::Infallible;
use std::sync::Arc;

#[derive(Debug, Deserialize)]
pub struct LlmCompletionRequest {
    /// Provider name (optional, uses default if omitted)
    pub provider: Option<String>,
    /// Model name (optional, uses provider default if omitted)
    pub model: Option<String>,
    /// System prompt
    pub system: Option<String>,
    /// Messages array
    pub messages: Vec<LlmMessage>,
    /// Tool definitions (optional)
    #[serde(default)]
    pub tools: Vec<ToolDefinition>,
    /// Max tokens (optional, defaults to 4096)
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct LlmMessage {
    pub role: String,
    pub content: Vec<ContentBlock>,
}

/// Pure LLM proxy endpoint.
/// Client sends system prompt, messages, and tool definitions.
/// Server resolves provider and streams back the raw LLM response.
pub async fn completion_handler(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LlmCompletionRequest>,
) -> impl IntoResponse {
    // Resolve provider
    let (record, provider) = if let Some(ref name) = body.provider {
        match provider_registry::resolve_provider(&state.db, name).await {
            Some(p) => p,
            None => return R::bad_request(&format!("Provider '{}' not found or disabled", name)),
        }
    } else {
        match provider_registry::resolve_default(&state.db).await {
            Some(p) => p,
            None => return R::internal_error("No provider available"),
        }
    };

    // Resolve model
    let model = if let Some(ref m) = body.model {
        provider_registry::resolve_model(&record, m)
    } else {
        provider_registry::resolve_default_model(&record)
    };

    // Convert messages
    let messages: Vec<Message> = body
        .messages
        .into_iter()
        .map(|m| Message {
            role: match m.role.as_str() {
                "assistant" => Role::Assistant,
                _ => Role::User,
            },
            content: m.content,
        })
        .collect();

    let req = CompletionRequest {
        model,
        system: body.system,
        messages,
        tools: body.tools,
        max_tokens: body.max_tokens.unwrap_or(4096),
    };

    let event_stream = match provider.stream(req).await {
        Ok(s) => s,
        Err(e) => return R::internal_error(e),
    };

    let sse_stream = event_stream.map(|result| match result {
        Ok(StreamEvent::TextDelta(text)) => {
            let json = serde_json::json!({"type": "text_delta", "text": text});
            Ok::<_, Infallible>(Event::default().data(json.to_string()))
        }
        Ok(StreamEvent::ToolUseStart { id, name }) => {
            let json = serde_json::json!({"type": "tool_use_start", "id": id, "name": name});
            Ok(Event::default().data(json.to_string()))
        }
        Ok(StreamEvent::ToolUseInputDelta(delta)) => {
            let json = serde_json::json!({"type": "tool_use_input_delta", "delta": delta});
            Ok(Event::default().data(json.to_string()))
        }
        Ok(StreamEvent::ToolUseEnd) => {
            let json = serde_json::json!({"type": "tool_use_end"});
            Ok(Event::default().data(json.to_string()))
        }
        Ok(StreamEvent::MessageEnd { stop_reason }) => {
            let json = serde_json::json!({"type": "message_end", "stop_reason": stop_reason});
            Ok(Event::default().data(json.to_string()))
        }
        Ok(StreamEvent::Usage { input_tokens, output_tokens }) => {
            let json = serde_json::json!({"type": "usage", "input_tokens": input_tokens, "output_tokens": output_tokens});
            Ok(Event::default().data(json.to_string()))
        }
        Ok(StreamEvent::Error(msg)) => {
            let json = serde_json::json!({"type": "error", "message": msg});
            Ok(Event::default().data(json.to_string()))
        }
        Err(e) => {
            let json = serde_json::json!({"type": "error", "message": e.to_string()});
            Ok(Event::default().data(json.to_string()))
        }
    });

    Sse::new(sse_stream).into_response()
}

// --- Tool Execution Endpoint ---

#[derive(Debug, Deserialize)]
pub struct ToolExecRequest {
    /// Tool name: "read_file" or "search"
    pub tool: String,
    /// Tool input as JSON object
    pub input: serde_json::Value,
    /// Working directory for tool execution
    pub work_dir: Option<String>,
}

/// Execute a single tool and return the result.
/// Client controls which tools to offer to LLM; this endpoint just runs them.
pub async fn tool_exec_handler(
    State(_state): State<Arc<AppState>>,
    Json(body): Json<ToolExecRequest>,
) -> impl IntoResponse {
    let work_dir = body.work_dir.clone();

    let result = match body.tool.as_str() {
        "read_file" => {
            let tool = ReadFileTool::new(work_dir);
            tool.execute(body.input).await
        }
        "search" => {
            let tool = SearchTool::new(work_dir);
            tool.execute(body.input).await
        }
        other => {
            return R::bad_request(&format!("Unknown tool: {}", other));
        }
    };

    match result {
        Ok(output) => R::ok(serde_json::json!({ "content": output.content, "is_error": output.is_error })),
        Err(e) => R::ok(serde_json::json!({ "content": e.to_string(), "is_error": true })),
    }
}
