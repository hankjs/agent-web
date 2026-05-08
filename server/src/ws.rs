use crate::{auth, AppState};
use axum::{
    extract::{Query, State, WebSocketUpgrade},
    extract::ws::{Message, WebSocket},
    response::IntoResponse,
};
use futures::{SinkExt, StreamExt};
use hank_agent::{AgentEvent, AgentSession, ClientMessage};
use hank_web_tools::{shell::ShellTool, Tool};
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{debug, error, info};

#[derive(Deserialize)]
pub struct WsQuery {
    pub token: String,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    Query(query): Query<WsQuery>,
) -> impl IntoResponse {
    if let Err(_e) = auth::verify_token(&query.token, &state.jwt_secret) {
        return (axum::http::StatusCode::UNAUTHORIZED, "Invalid token").into_response();
    }

    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    info!("WebSocket client connected");

    while let Some(Ok(msg)) = ws_rx.next().await {
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => break,
            _ => continue,
        };

        let client_msg: ClientMessage = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => {
                let err = serde_json::json!({"type": "error", "message": e.to_string()});
                let _ = ws_tx.send(Message::Text(err.to_string().into())).await;
                continue;
            }
        };

        match client_msg {
            ClientMessage::SendMessage {
                content,
                session_id,
                provider: provider_name,
                model,
            } => {
                // Resolve provider: use requested or default
                let provider_key = provider_name
                    .as_deref()
                    .unwrap_or(&state.config.server.default_provider);

                let provider = match state.get_provider(provider_key) {
                    Some(p) => p,
                    None => {
                        let err = serde_json::json!({
                            "type": "error",
                            "message": format!("Unknown provider: {provider_key}")
                        });
                        let _ = ws_tx.send(Message::Text(err.to_string().into())).await;
                        continue;
                    }
                };

                // Resolve model: alias → actual model ID, fallback to provider's default
                let provider_config = state.config.find_provider(provider_key);
                let model = match (model, provider_config) {
                    (Some(m), Some(pc)) => pc.resolve_model(&m),
                    (Some(m), None) => m,
                    (None, Some(pc)) => pc.resolve_default_model(),
                    (None, None) => "claude-sonnet-4-20250514".to_string(),
                };

                let tools: Vec<Arc<dyn Tool>> = vec![Arc::new(ShellTool::new())];

                let mut session = AgentSession::new(
                    provider,
                    tools,
                    model,
                    "You are a helpful AI assistant with access to shell commands. Execute tasks the user requests.".to_string(),
                );

                // Load existing messages from DB
                if let Ok(db_messages) = state.db.get_messages(&session_id).await {
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
                    session.set_messages(messages);
                }

                let (event_tx, mut event_rx) = mpsc::channel::<AgentEvent>(64);
                let db = state.db.clone();
                let sid = session_id.clone();

                tokio::spawn(async move {
                    if let Err(e) = session.run(content, event_tx).await {
                        error!("Agent error: {e}");
                    }

                    for msg in session.messages() {
                        let role = match msg.role {
                            hank_provider::Role::User => "user",
                            hank_provider::Role::Assistant => "assistant",
                        };
                        let content = serde_json::to_value(&msg.content).unwrap_or_default();
                        let _ = db.save_message(&sid, role, &content).await;
                    }
                });

                while let Some(event) = event_rx.recv().await {
                    let json = serde_json::to_string(&event).unwrap_or_default();
                    if ws_tx.send(Message::Text(json.into())).await.is_err() {
                        break;
                    }
                }
            }
            ClientMessage::Cancel => {
                debug!("Cancel requested (not yet implemented)");
            }
        }
    }

    info!("WebSocket client disconnected");
}
