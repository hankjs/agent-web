mod admin;
mod auth;
mod chat;
mod config;
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
use config::{Config, ProviderType};
use hank_db::Database;
use hank_provider::LlmProvider;
use std::collections::HashMap;
use std::sync::Arc;
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
    pub providers: HashMap<String, Arc<dyn LlmProvider>>,
    pub active_tasks: RwLock<HashMap<String, CancellationToken>>,
    pub event_buffers: RwLock<HashMap<String, EventBuffer>>,
}

impl AppState {
    pub fn get_provider(&self, name: &str) -> Option<Arc<dyn LlmProvider>> {
        self.providers.get(name).cloned()
    }
}

fn build_providers(config: &Config) -> HashMap<String, Arc<dyn LlmProvider>> {
    use hank_provider::anthropic::AnthropicProvider;
    use hank_provider::openai::OpenAiProvider;

    let mut map: HashMap<String, Arc<dyn LlmProvider>> = HashMap::new();

    for p in &config.providers {
        let provider: Arc<dyn LlmProvider> = match p.provider_type {
            ProviderType::Anthropic => Arc::new(
                AnthropicProvider::new(p.api_key.clone()).with_base_url(p.base_url.clone()),
            ),
            ProviderType::Openai => Arc::new(
                OpenAiProvider::new(p.api_key.clone())
                    .with_base_url(p.base_url.clone())
                    .with_name(p.name.clone()),
            ),
        };
        tracing::info!("Loaded provider: {} ({:?})", p.name, p.provider_type);
        map.insert(p.name.clone(), provider);
    }

    map
}

async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    request: Request<axum::body::Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    match token {
        Some(t) if auth::verify_token(t, &state.jwt_secret).is_ok() => Ok(next.run(request).await),
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
    let providers = build_providers(&config);

    if providers.is_empty() {
        anyhow::bail!("No providers configured. Check config.toml");
    }

    let state = Arc::new(AppState {
        db,
        jwt_secret: config.server.jwt_secret.clone(),
        providers,
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
        .route("/api/admin/replay", post(admin::replay_with_prompt))
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
