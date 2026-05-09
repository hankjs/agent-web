use crate::AppState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{
        sse::{Event, Sse},
        IntoResponse,
    },
    Json,
};
use hank_agent::{AgentEvent, AgentSession};
use hank_web_tools::{
    read_file::ReadFileTool, search::SearchTool, shell::ShellTool, write_file::WriteFileTool, Tool,
};
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

// --- Request/Response types ---

#[derive(Deserialize)]
pub struct PaginationQuery {
    pub page: Option<u32>,
    pub per_page: Option<u32>,
    pub search: Option<String>,
}

#[derive(Serialize)]
pub struct PaginatedResponse<T: Serialize> {
    pub data: Vec<T>,
    pub total: u64,
    pub page: u32,
    pub per_page: u32,
}

#[derive(Deserialize)]
pub struct PromptTemplateRequest {
    pub name: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct ReplayRequest {
    pub session_id: String,
    pub prompt_template_id: Option<String>,
    pub system_prompt: Option<String>,
}

// --- Handlers ---

pub async fn list_sessions(
    State(state): State<Arc<AppState>>,
    Query(query): Query<PaginationQuery>,
) -> impl IntoResponse {
    let page = query.page.unwrap_or(1).max(1);
    let per_page = query.per_page.unwrap_or(20).min(100);

    let all_sessions = match state.db.list_sessions().await {
        Ok(s) => s,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };

    let filtered: Vec<_> = if let Some(ref search) = query.search {
        let s = search.to_lowercase();
        all_sessions.into_iter().filter(|sess| {
            sess.title.to_lowercase().contains(&s) || sess.id.contains(&s)
        }).collect()
    } else {
        all_sessions
    };

    let total = filtered.len() as u64;
    let start = ((page - 1) * per_page) as usize;
    let data: Vec<_> = filtered.into_iter().skip(start).take(per_page as usize).collect();

    Json(PaginatedResponse { data, total, page, per_page }).into_response()
}

pub async fn session_replay(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
) -> impl IntoResponse {
    let messages = match state.db.get_messages(&session_id).await {
        Ok(m) => m,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let metrics = state.db.get_session_metrics(&session_id).await.unwrap_or_default();
    let tool_executions = state.db.get_session_tool_executions(&session_id).await.unwrap_or_default();

    #[derive(Serialize)]
    struct ReplayResponse {
        messages: Vec<hank_db::DbMessage>,
        metrics: Vec<hank_db::AgentMetric>,
        tool_executions: Vec<hank_db::ToolExecution>,
    }

    Json(ReplayResponse { messages, metrics, tool_executions }).into_response()
}

pub async fn metrics_overview(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    match state.db.get_metrics_overview().await {
        Ok(overview) => Json(overview).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn metrics_by_session(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
) -> impl IntoResponse {
    let metrics = state.db.get_session_metrics(&session_id).await.unwrap_or_default();
    let tool_executions = state.db.get_session_tool_executions(&session_id).await.unwrap_or_default();

    #[derive(Serialize)]
    struct SessionMetrics {
        metrics: Vec<hank_db::AgentMetric>,
        tool_executions: Vec<hank_db::ToolExecution>,
    }

    Json(SessionMetrics { metrics, tool_executions }).into_response()
}

pub async fn create_prompt_template(
    State(state): State<Arc<AppState>>,
    Json(body): Json<PromptTemplateRequest>,
) -> impl IntoResponse {
    match state.db.save_prompt_template(&body.name, &body.content).await {
        Ok(id) => (StatusCode::CREATED, Json(serde_json::json!({"id": id}))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn list_prompt_templates(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    match state.db.list_prompt_templates().await {
        Ok(templates) => Json(templates).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn replay_with_prompt(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ReplayRequest>,
) -> impl IntoResponse {
    // Load original session messages (user messages only)
    let all_messages = match state.db.get_messages(&body.session_id).await {
        Ok(m) => m,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };

    let user_messages: Vec<String> = all_messages.iter()
        .filter(|m| m.role == "user")
        .filter_map(|m| {
            let blocks: Vec<serde_json::Value> = serde_json::from_str(&m.content).ok()?;
            blocks.iter().find_map(|b| b.get("text").and_then(|t| t.as_str()).map(|s| s.to_string()))
        })
        .collect();

    if user_messages.is_empty() {
        return (StatusCode::BAD_REQUEST, "No user messages found in session").into_response();
    }

    // Determine system prompt
    let system_prompt = if let Some(ref prompt) = body.system_prompt {
        prompt.clone()
    } else if let Some(ref template_id) = body.prompt_template_id {
        match state.db.get_prompt_template(template_id).await {
            Ok(Some(t)) => t.content,
            _ => return (StatusCode::BAD_REQUEST, "Template not found").into_response(),
        }
    } else {
        "You are a helpful AI assistant.".to_string()
    };

    // Get default provider
    let provider_key = &state.config.server.default_provider;
    let provider = match state.get_provider(provider_key) {
        Some(p) => p,
        None => return (StatusCode::INTERNAL_SERVER_ERROR, "No provider available").into_response(),
    };

    let model = state.config.find_provider(provider_key)
        .map(|pc| pc.resolve_default_model())
        .unwrap_or_else(|| "claude-sonnet-4-20250514".to_string());

    let tools: Vec<Arc<dyn Tool>> = vec![
        Arc::new(ShellTool::new(None)),
        Arc::new(ReadFileTool::new(None)),
        Arc::new(WriteFileTool::new(None)),
        Arc::new(SearchTool::new(None)),
    ];

    let mut session = AgentSession::new(provider, tools, model, system_prompt);
    let (event_tx, mut event_rx) = mpsc::channel::<AgentEvent>(64);
    let cancel = CancellationToken::new();

    // Spawn agent task that replays all user messages sequentially
    tokio::spawn(async move {
        for msg in user_messages {
            if let Err(e) = session.run(msg, event_tx.clone(), cancel.clone()).await {
                let _ = event_tx.send(AgentEvent::Error { message: format!("{e:#}") }).await;
                break;
            }
        }
    });

    // Stream results as SSE
    let stream = async_stream::stream! {
        while let Some(event) = event_rx.recv().await {
            let json = serde_json::to_string(&event).unwrap_or_default();
            yield Ok::<_, Infallible>(Event::default().data(json));
        }
    };

    Sse::new(stream).into_response()
}
