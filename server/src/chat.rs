use crate::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse,
    },
};
use futures::{stream::Stream, StreamExt};
use hank_agent::{AgentEvent, AgentSession};
use hank_web_tools::{shell::ShellTool, Tool};
use serde::Deserialize;
use std::convert::Infallible;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tracing::error;

use crate::config::DEFAULT_MODEL;

#[derive(Deserialize)]
pub struct ChatRequest {
    pub content: String,
    pub provider: Option<String>,
    pub model: Option<String>,
}

pub async fn chat_handler(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    axum::Json(body): axum::Json<ChatRequest>,
) -> impl IntoResponse {
    // Resolve provider
    let provider_key = body
        .provider
        .as_deref()
        .unwrap_or(&state.config.server.default_provider);

    let provider = match state.get_provider(provider_key) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                format!("Unknown provider: {provider_key}"),
            )
                .into_response();
        }
    };

    // Resolve model from config
    let provider_config = state.config.find_provider(provider_key);
    let model = match (body.model, provider_config) {
        (Some(m), Some(pc)) => pc.resolve_model(&m),
        (Some(m), None) => m,
        (None, Some(pc)) => pc.resolve_default_model(),
        (None, None) => DEFAULT_MODEL.to_string(),
    };

    // Look up session for work_dir
    let session_record = state.db.get_session(&session_id).await.ok().flatten();
    let work_dir = session_record.as_ref().and_then(|s| s.work_dir.clone());

    let tools: Vec<Arc<dyn Tool>> = vec![Arc::new(ShellTool::new(work_dir))];

    let mut session = AgentSession::new(
        provider,
        tools,
        model,
        "You are a helpful AI assistant with access to shell commands. Execute tasks the user requests.".to_string(),
    );

    // Load existing messages from DB
    let history_len = if let Ok(db_messages) = state.db.get_messages(&session_id).await {
        let messages: Vec<hank_provider::Message> = db_messages
            .iter()
            .filter_map(|m| {
                let content: Vec<hank_provider::ContentBlock> =
                    serde_json::from_str(&m.content).ok()?;
                let role = match m.role.as_str() {
                    "user" => hank_provider::Role::User,
                    "assistant" => hank_provider::Role::Assistant,
                    _ => return None,
                };
                Some(hank_provider::Message { role, content })
            })
            .collect();
        let len = messages.len();
        session.set_messages(messages);
        len
    } else {
        0
    };

    // Set up SSE stream via mpsc channel
    let (event_tx, event_rx) = mpsc::channel::<AgentEvent>(64);
    let db = state.db.clone();
    let sid = session_id.clone();
    let content = body.content;
    let is_first_message = history_len == 0;

    tokio::spawn(async move {
        if let Err(e) = session.run(content.clone(), event_tx.clone()).await {
            error!("Agent error: {e}");
            let _ = event_tx
                .send(AgentEvent::Error {
                    message: e.to_string(),
                })
                .await;
        }

        // Batch save new messages to DB
        let new_messages: Vec<_> = session.messages().iter().skip(history_len).collect();
        if !new_messages.is_empty() {
            let base_time = chrono::Utc::now();
            for (i, msg) in new_messages.iter().enumerate() {
                let role = match msg.role {
                    hank_provider::Role::User => "user",
                    hank_provider::Role::Assistant => "assistant",
                };
                let content_val = serde_json::to_value(&msg.content).unwrap_or_default();
                let ts = base_time + chrono::Duration::microseconds(i as i64);
                let _ = db.save_message(&sid, role, &content_val, ts).await;
            }
            // Single updated_at bump after all messages saved
            let _ = db.touch_session(&sid).await;
        }

        // Auto-set title from first user message
        if is_first_message {
            let title: String = content.chars().take(50).collect();
            let _ = db.update_session_title(&sid, &title).await;
        }
    });

    let stream = make_sse_stream(event_rx);
    Sse::new(stream)
        .keep_alive(KeepAlive::default())
        .into_response()
}

fn make_sse_stream(
    rx: mpsc::Receiver<AgentEvent>,
) -> impl Stream<Item = Result<Event, Infallible>> {
    ReceiverStream::new(rx).map(|event| {
        let json = serde_json::to_string(&event).unwrap_or_default();
        Ok(Event::default().data(json))
    })
}
