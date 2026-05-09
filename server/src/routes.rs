use crate::AppState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::auth;
use crate::config::DEFAULT_MODEL;

fn internal_error(e: impl ToString) -> axum::response::Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({"error": e.to_string()})),
    )
        .into_response()
}

pub async fn health() -> impl IntoResponse {
    Json(serde_json::json!({"status": "ok"}))
}

#[derive(Deserialize)]
pub struct LoginRequest {
    // Accepted from client but not validated in single-user mode
    #[allow(dead_code)]
    pub password: Option<String>,
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(_body): Json<LoginRequest>,
) -> impl IntoResponse {
    match auth::create_token(&state.jwt_secret) {
        Ok(token) => (StatusCode::OK, Json(serde_json::json!({"token": token}))).into_response(),
        Err(e) => internal_error(e),
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
    let provider = body
        .provider
        .unwrap_or_else(|| state.config.server.default_provider.clone());
    let model = body.model.unwrap_or_else(|| {
        state
            .config
            .find_provider(&provider)
            .map(|pc| pc.resolve_default_model())
            .unwrap_or_else(|| DEFAULT_MODEL.to_string())
    });

    match state
        .db
        .create_session(&provider, &model, body.work_dir.as_deref())
        .await
    {
        Ok(session) => (StatusCode::CREATED, Json(serde_json::json!(session))).into_response(),
        Err(e) => internal_error(e),
    }
}

pub async fn list_sessions(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.db.list_sessions().await {
        Ok(sessions) => Json(serde_json::json!(sessions)).into_response(),
        Err(e) => internal_error(e),
    }
}

pub async fn get_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.db.get_session(&id).await {
        Ok(Some(session)) => Json(serde_json::json!(session)).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => internal_error(e),
    }
}

pub async fn delete_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.db.delete_session(&id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => internal_error(e),
    }
}

#[derive(Deserialize)]
pub struct UpdateSessionRequest {
    pub title: Option<String>,
    pub work_dir: Option<String>,
}

pub async fn update_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<UpdateSessionRequest>,
) -> impl IntoResponse {
    if let Some(title) = &body.title {
        if let Err(e) = state.db.update_session_title(&id, title).await {
            return internal_error(e);
        }
    }
    if body.work_dir.is_some() {
        if let Err(e) = state.db.update_session_work_dir(&id, body.work_dir.as_deref()).await {
            return internal_error(e);
        }
    }
    match state.db.get_session(&id).await {
        Ok(Some(session)) => Json(serde_json::json!(session)).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => internal_error(e),
    }
}

pub async fn get_messages(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.db.get_messages(&id).await {
        Ok(messages) => Json(serde_json::json!(messages)).into_response(),
        Err(e) => internal_error(e),
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
            return internal_error(e);
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
                "type": format!("{:?}", p.provider_type).to_lowercase(),
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

pub async fn list_directory(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ListDirQuery>,
) -> impl IntoResponse {
    let dir_path = match &query.path {
        Some(p) if !p.is_empty() => std::path::PathBuf::from(p),
        _ => dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/")),
    };

    // Validate path is under allowed directories (if configured)
    if !state.config.server.allowed_dirs.is_empty() {
        let canonical = dir_path.canonicalize().unwrap_or_else(|_| dir_path.clone());
        let allowed = state.config.server.allowed_dirs.iter().any(|allowed| {
            let allowed_path = std::path::Path::new(allowed);
            canonical.starts_with(allowed_path)
        });
        if !allowed {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Path not in allowed directories"})),
            )
                .into_response();
        }
    }

    // Use spawn_blocking to avoid blocking the async runtime
    let dir_path_clone = dir_path.clone();
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/"));
    let entries_result = tokio::task::spawn_blocking(move || {
        match std::fs::read_dir(&dir_path_clone) {
            Ok(rd) => Ok((rd, dir_path_clone, false)),
            Err(_) => {
                // Directory doesn't exist, fall back to home
                std::fs::read_dir(&home).map(|rd| (rd, home, true))
            }
        }
    })
    .await
    .unwrap_or_else(|e| Err(std::io::Error::new(std::io::ErrorKind::Other, e)));

    let (entries, dir_path, redirected) = match entries_result {
        Ok(tuple) => tuple,
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
        a["name"]
            .as_str()
            .unwrap_or("")
            .cmp(b["name"].as_str().unwrap_or(""))
    });

    let parent = dir_path
        .parent()
        .map(|p| p.to_string_lossy().to_string());

    let mut result = serde_json::json!({
        "path": dir_path.to_string_lossy(),
        "parent": parent,
        "entries": dirs,
    });
    if redirected {
        result["redirected"] = serde_json::json!(true);
        result["message"] = serde_json::json!(format!(
            "目录已被移除，已重定向到 {}",
            dir_path.to_string_lossy()
        ));
    }

    Json(result).into_response()
}
