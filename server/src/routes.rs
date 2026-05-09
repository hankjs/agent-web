use crate::AppState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::auth::{self, Claims};
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
    pub username: Option<String>,
    pub password: Option<String>,
    pub scope: Option<String>, // "admin" or "client"
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LoginRequest>,
) -> impl IntoResponse {
    let username = body.username.unwrap_or_default();
    let password = body.password.unwrap_or_default();
    let scope = body.scope.unwrap_or_else(|| "client".to_string());

    let user = match state.db.get_user_by_username(&username).await {
        Ok(Some(u)) => u,
        _ => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "invalid credentials"}))).into_response(),
    };

    if !bcrypt::verify(&password, &user.password_hash).unwrap_or(false) {
        return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "invalid credentials"}))).into_response();
    }

    // Check scope permission
    if scope == "admin" && !user.can_login_admin {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "no admin access"}))).into_response();
    }
    if scope == "client" && !user.can_login_client {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "no client access"}))).into_response();
    }

    match auth::create_token(&state.jwt_secret, &user.id, &user.username, user.can_login_admin, user.can_login_client) {
        Ok(token) => (StatusCode::OK, Json(serde_json::json!({"token": token, "username": user.username, "can_admin": user.can_login_admin, "can_client": user.can_login_client}))).into_response(),
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
    Extension(claims): Extension<Claims>,
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
        .create_session(&provider, &model, body.work_dir.as_deref(), Some(&claims.sub))
        .await
    {
        Ok(session) => (StatusCode::CREATED, Json(serde_json::json!(session))).into_response(),
        Err(e) => internal_error(e),
    }
}

pub async fn list_sessions(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match state.db.list_sessions_by_user(&claims.sub).await {
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
    Query(query): Query<GetMessagesQuery>,
) -> impl IntoResponse {
    // If leaf_id provided, return branch messages; otherwise use active_leaf or all
    if let Some(leaf_id) = &query.leaf_id {
        match state.db.get_branch_messages(&id, leaf_id).await {
            Ok(messages) => Json(serde_json::json!(messages)).into_response(),
            Err(e) => internal_error(e),
        }
    } else {
        // Try to use active_leaf_id from session
        let session = state.db.get_session(&id).await.ok().flatten();
        if let Some(leaf) = session.and_then(|s| s.active_leaf_id) {
            match state.db.get_branch_messages(&id, &leaf).await {
                Ok(messages) => Json(serde_json::json!(messages)).into_response(),
                Err(e) => internal_error(e),
            }
        } else {
            // Fallback: return all messages (legacy behavior for sessions without tree)
            match state.db.get_messages(&id).await {
                Ok(messages) => Json(serde_json::json!(messages)).into_response(),
                Err(e) => internal_error(e),
            }
        }
    }
}

#[derive(Deserialize)]
pub struct GetMessagesQuery {
    pub leaf_id: Option<String>,
}

pub async fn get_message_tree(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.db.get_message_tree(&id).await {
        Ok(tree) => Json(serde_json::json!(tree)).into_response(),
        Err(e) => internal_error(e),
    }
}

#[derive(Deserialize)]
pub struct UpdateActiveLeafRequest {
    pub leaf_id: String,
}

pub async fn update_active_leaf(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<UpdateActiveLeafRequest>,
) -> impl IntoResponse {
    match state.db.update_active_leaf(&id, &body.leaf_id).await {
        Ok(()) => Json(serde_json::json!({"status": "ok"})).into_response(),
        Err(e) => internal_error(e),
    }
}

#[derive(Deserialize)]
pub struct TruncateMessagesRequest {
    pub keep_count: u32,
}

pub async fn truncate_messages(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<TruncateMessagesRequest>,
) -> impl IntoResponse {
    match state.db.truncate_messages(&id, body.keep_count).await {
        Ok(deleted) => Json(serde_json::json!({"deleted": deleted})).into_response(),
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
    let providers = state.db.list_providers_ordered().await.unwrap_or_default();
    let provider_list: Vec<serde_json::Value> = providers
        .iter()
        .filter(|p| p.enabled)
        .map(|p| {
            let models: serde_json::Value = serde_json::from_str(&p.models).unwrap_or(serde_json::json!({}));
            serde_json::json!({
                "name": p.name,
                "type": p.provider_type,
                "default_model": p.default_model,
                "models": models,
            })
        })
        .collect();

    Json(serde_json::json!({
        "providers": provider_list,
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
