mod auth;
mod config;
mod routes;
mod ws;

use anyhow::Result;
use axum::{routing::{get, post, put, delete}, Router};
use config::Config;
use hank_db::Database;
use hank_provider::LlmProvider;
use std::collections::HashMap;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

pub struct AppState {
    pub db: Database,
    pub jwt_secret: String,
    pub config: Config,
    pub providers: HashMap<String, Arc<dyn LlmProvider>>,
}

impl AppState {
    pub fn get_provider(&self, name: &str) -> Option<Arc<dyn LlmProvider>> {
        self.providers.get(name).cloned()
    }

    pub fn default_provider(&self) -> Option<Arc<dyn LlmProvider>> {
        self.get_provider(&self.config.server.default_provider)
    }
}

fn build_providers(config: &Config) -> HashMap<String, Arc<dyn LlmProvider>> {
    use hank_provider::anthropic::AnthropicProvider;
    use hank_provider::openai::OpenAiProvider;

    let mut map: HashMap<String, Arc<dyn LlmProvider>> = HashMap::new();

    for p in &config.providers {
        let provider: Arc<dyn LlmProvider> = match p.provider_type.as_str() {
            "anthropic" => Arc::new(
                AnthropicProvider::new(p.api_key.clone()).with_base_url(p.base_url.clone()),
            ),
            "openai" => Arc::new(
                OpenAiProvider::new(p.api_key.clone())
                    .with_base_url(p.base_url.clone())
                    .with_name(p.name.clone()),
            ),
            other => {
                tracing::warn!("Unknown provider type '{other}', skipping: {}", p.name);
                continue;
            }
        };
        tracing::info!("Loaded provider: {} ({})", p.name, p.provider_type);
        map.insert(p.name.clone(), provider);
    }

    map
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
    });

    let app = Router::new()
        .route("/api/health", get(routes::health))
        .route("/api/auth/login", post(routes::login))
        .route("/api/sessions", post(routes::create_session))
        .route("/api/sessions", get(routes::list_sessions))
        .route("/api/sessions/{id}", get(routes::get_session))
        .route("/api/sessions/{id}", delete(routes::delete_session))
        .route("/api/sessions/{id}/messages", get(routes::get_messages))
        .route("/api/settings", put(routes::update_settings))
        .route("/api/providers", get(routes::list_providers))
        .route("/ws", get(ws::ws_handler))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.server.host, config.server.port);
    tracing::info!("Server listening on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
