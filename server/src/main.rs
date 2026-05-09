mod admin;
mod auth;
mod chat;
mod config;
pub mod provider_registry;
mod routes;

use anyhow::Result;
use axum::{
    extract::State,
    http::{HeaderMap, Request, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::{delete, get, post, put},
    Router,
};
use config::Config;
use hank_db::Database;
use std::sync::Arc;
use std::collections::HashMap;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use crate::chat::EventBuffer;

pub struct AppState {
    pub db: Database,
    pub jwt_secret: String,
    pub config: Config,
    pub active_tasks: RwLock<HashMap<String, CancellationToken>>,
    pub event_buffers: RwLock<HashMap<String, EventBuffer>>,
}

async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    mut request: Request<axum::body::Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    match token {
        Some(t) => match auth::verify_token(t, &state.jwt_secret) {
            Ok(claims) => {
                request.extensions_mut().insert(claims);
                Ok(next.run(request).await)
            }
            Err(_) => Err(StatusCode::UNAUTHORIZED),
        },
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("hank=debug".parse()?))
        .init();

    let config = Config::load()?;
    let db = Database::new(&config.server.database_url).await?;


    let state = Arc::new(AppState {
        db,
        jwt_secret: config.server.jwt_secret.clone(),
        config: config.clone(),
        active_tasks: RwLock::new(HashMap::new()),
        event_buffers: RwLock::new(HashMap::new()),
    });

    // Public routes (no auth required)
    let public = Router::new()
        .route("/api/health", get(routes::health))
        .route("/api/auth/login", post(routes::login));

    // Protected routes (auth required)
    let protected = Router::new()
        .route("/api/sessions", post(routes::create_session))
        .route("/api/sessions", get(routes::list_sessions))
        .route("/api/sessions/{id}", get(routes::get_session))
        .route("/api/sessions/{id}", delete(routes::delete_session))
        .route("/api/sessions/{id}", put(routes::update_session))
        .route("/api/sessions/{id}/messages", get(routes::get_messages))
        .route("/api/sessions/{id}/messages/truncate", post(routes::truncate_messages))
        .route("/api/sessions/{id}/tree", get(routes::get_message_tree))
        .route("/api/sessions/{id}/active-leaf", put(routes::update_active_leaf))
        .route("/api/settings", put(routes::update_settings))
        .route("/api/providers", get(routes::list_providers))
        .route("/api/sessions/{id}/chat", post(chat::chat_handler))
        .route("/api/sessions/{id}/stop", post(chat::stop_handler))
        .route("/api/sessions/{id}/events/resume", get(chat::resume_handler))
        .route("/api/fs/list", get(routes::list_directory))
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware));

    // Admin API routes (also protected)
    let admin_api = Router::new()
        .route("/api/admin/sessions", get(admin::list_sessions))
        .route("/api/admin/sessions/{id}/replay", get(admin::session_replay))
        .route("/api/admin/metrics/overview", get(admin::metrics_overview))
        .route("/api/admin/metrics/by-session/{id}", get(admin::metrics_by_session))
        .route("/api/admin/prompt-templates", post(admin::create_prompt_template))
        .route("/api/admin/prompt-templates", get(admin::list_prompt_templates))
        .route("/api/admin/prompt-templates/{id}", delete(admin::delete_prompt_template))
        .route("/api/admin/chat/generate", post(admin::chat_generate))
        .route("/api/admin/replay", post(admin::replay_with_prompt))
        .route("/api/admin/users", get(admin::list_users))
        .route("/api/admin/users", post(admin::create_user))
        .route("/api/admin/users/{id}", put(admin::update_user))
        .route("/api/admin/users/{id}", delete(admin::delete_user))
        .route("/api/admin/providers", get(admin::list_providers))
        .route("/api/admin/providers", post(admin::create_provider))
        .route("/api/admin/providers/{id}", put(admin::update_provider))
        .route("/api/admin/providers/{id}", delete(admin::delete_provider))
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware));

    // Static file serving for admin SPA
    let admin_static = ServeDir::new("admin/dist")
        .not_found_service(ServeFile::new("admin/dist/index.html"));

    let app = public
        .merge(protected)
        .merge(admin_api)
        .nest_service("/admin", admin_static)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.server.host, config.server.port);
    tracing::info!("Server listening on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
