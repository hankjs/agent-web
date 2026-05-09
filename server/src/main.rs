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
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

pub struct AppState {
    pub db: Database,
    pub jwt_secret: String,
    pub config: Config,
    pub providers: HashMap<String, Arc<dyn LlmProvider>>,
    pub active_tasks: RwLock<HashMap<String, CancellationToken>>,
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
        .route("/api/settings", put(routes::update_settings))
        .route("/api/providers", get(routes::list_providers))
        .route("/api/sessions/{id}/chat", post(chat::chat_handler))
        .route("/api/sessions/{id}/stop", post(chat::stop_handler))
        .route("/api/fs/list", get(routes::list_directory))
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware));

    let app = public
        .merge(protected)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.server.host, config.server.port);
    tracing::info!("Server listening on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
