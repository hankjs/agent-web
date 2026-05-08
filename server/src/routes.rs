use crate::{auth, AppState};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

pub async fn health() -> impl IntoResponse {
    Json(serde_json::json!({"status": "ok"}))
}

#[derive(Deserialize)]
pub struct LoginRequest {
    #[allow(dead_code)]
    pub password: Option<String>,
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(_body): Json<LoginRequest>,
) -> impl IntoResponse {
    // Simple single-user auth: just issue a token
    match auth::create_token(&state.jwt_secret) {
        Ok(token) => (StatusCode::OK, Json(serde_json::json!({"token": token}))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
pub struct CreateSessionRequest {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub work_dir: Option<String>,
}

pub async fn create_session(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateSessionRequest>,
) -> impl IntoResponse {
    let provider = body.provider.unwrap_or_else(|| "anthropic".to_string());
    let model = body.model.unwrap_or_else(|| "claude-sonnet-4-20250514".to_string());

    match state.db.create_session(&provider, &model, body.work_dir.as_deref()).await {
        Ok(session) => (StatusCode::CREATED, Json(serde_json::json!(session))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

pub async fn list_sessions(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.db.list_sessions().await {
        Ok(sessions) => Json(serde_json::json!(sessions)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

pub async fn get_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.db.get_session(&id).await {
        Ok(Some(session)) => Json(serde_json::json!(session)).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

pub async fn delete_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.db.delete_session(&id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

pub async fn get_messages(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.db.get_messages(&id).await {
        Ok(messages) => Json(serde_json::json!(messages)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
pub struct UpdateSettingsRequest {
    pub settings: std::collections::HashMap<String, String>,
}

pub async fn update_settings(
    State(state): State<Arc<AppState>>,
    Json(body): Json<UpdateSettingsRequest>,
) -> impl IntoResponse {
    for (key, value) in &body.settings {
        if let Err(e) = state.db.set_setting(key, value).await {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response();
        }
    }
    Json(serde_json::json!({"status": "ok"})).into_response()
}

pub async fn list_providers(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let providers: Vec<serde_json::Value> = state
        .config
        .providers
        .iter()
        .map(|p| {
            serde_json::json!({
                "name": p.name,
                "type": p.provider_type,
                "default_model": p.default_model,
                "models": p.models,
            })
        })
        .collect();

    Json(serde_json::json!({
        "providers": providers,
        "default_provider": state.config.server.default_provider,
    }))
}

#[derive(Deserialize)]
pub struct ListDirQuery {
    pub path: Option<String>,
}

pub async fn list_directory(Query(query): Query<ListDirQuery>) -> impl IntoResponse {
    let dir_path = match &query.path {
        Some(p) if !p.is_empty() => std::path::PathBuf::from(p),
        _ => dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/")),
    };

    let entries = match std::fs::read_dir(&dir_path) {
        Ok(rd) => rd,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response();
        }
    };

    let mut dirs: Vec<serde_json::Value> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            dirs.push(serde_json::json!({ "name": name, "is_dir": true }));
        }
    }
    dirs.sort_by(|a, b| {
        a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or(""))
    });

    let parent = dir_path.parent().map(|p| p.to_string_lossy().to_string());

    Json(serde_json::json!({
        "path": dir_path.to_string_lossy(),
        "parent": parent,
        "entries": dirs,
    }))
    .into_response()
}
