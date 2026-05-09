use hank_db::{Database, ProviderRecord};
use hank_provider::LlmProvider;
use std::collections::HashMap;
use std::sync::Arc;

use crate::config::ProviderConfig;

/// Build an LlmProvider instance from a ProviderRecord.
pub fn build_provider_from_record(record: &ProviderRecord) -> Arc<dyn LlmProvider> {
    use hank_provider::anthropic::AnthropicProvider;
    use hank_provider::openai::OpenAiProvider;

    match record.provider_type.as_str() {
        "anthropic" => Arc::new(
            AnthropicProvider::new(record.api_key.clone())
                .with_base_url(record.base_url.clone()),
        ),
        _ => Arc::new(
            OpenAiProvider::new(record.api_key.clone())
                .with_base_url(record.base_url.clone())
                .with_name(record.name.clone()),
        ),
    }
}

/// Resolve a single provider by name from DB.
pub async fn resolve_provider(db: &Database, name: &str) -> Option<(ProviderRecord, Arc<dyn LlmProvider>)> {
    let record = db.get_provider_by_name(name).await.ok()??;
    if !record.enabled {
        return None;
    }
    let provider = build_provider_from_record(&record);
    Some((record, provider))
}

/// Get the model map from a ProviderRecord's JSON models field.
pub fn get_models_map(record: &ProviderRecord) -> HashMap<String, String> {
    serde_json::from_str(&record.models).unwrap_or_default()
}

/// Resolve model name using the provider record's model aliases.
pub fn resolve_model(record: &ProviderRecord, model_name: &str) -> String {
    let models = get_models_map(record);
    models.get(model_name).cloned().unwrap_or_else(|| model_name.to_string())
}

/// Resolve default model for a provider record.
pub fn resolve_default_model(record: &ProviderRecord) -> String {
    resolve_model(record, &record.default_model)
}

/// Returns an ordered list of providers for fallback: preferred first, then remaining by priority.
/// Only returns enabled providers.
pub async fn resolve_with_fallback(
    db: &Database,
    preferred_name: &str,
) -> Vec<(ProviderRecord, Arc<dyn LlmProvider>)> {
    let all = db.list_providers_ordered().await.unwrap_or_default();
    let mut result = Vec::new();

    // Put preferred first
    if let Some(pref) = all.iter().find(|r| r.name == preferred_name && r.enabled) {
        result.push((pref.clone(), build_provider_from_record(pref)));
    }

    // Then remaining enabled providers by priority
    for record in &all {
        if record.name == preferred_name || !record.enabled {
            continue;
        }
        result.push((record.clone(), build_provider_from_record(record)));
    }

    result
}

/// Seed providers from config into DB if the providers table is empty.
pub async fn seed_from_config(db: &Database, providers: &[ProviderConfig]) {
    let count = db.provider_count().await.unwrap_or(0);
    if count > 0 {
        return;
    }

    for (i, p) in providers.iter().enumerate() {
        let provider_type = match p.provider_type {
            crate::config::ProviderType::Anthropic => "anthropic",
            crate::config::ProviderType::Openai => "openai",
        };
        let models_json = serde_json::to_string(&p.models).unwrap_or_else(|_| "{}".to_string());
        let _ = db.create_provider(
            &p.name,
            provider_type,
            &p.api_key,
            &p.base_url,
            &p.default_model,
            &models_json,
            i as i32,
            true,
        ).await;
        tracing::info!("Seeded provider from config: {}", p.name);
    }
}
