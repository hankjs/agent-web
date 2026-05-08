use anyhow::{bail, Context, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub server: ServerConfig,
    pub providers: Vec<ProviderConfig>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub jwt_secret: String,
    pub database_url: String,
    #[serde(default = "default_provider")]
    pub default_provider: String,
}

fn default_provider() -> String {
    "anthropic".to_string()
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProviderConfig {
    pub name: String,
    #[serde(rename = "type")]
    pub provider_type: String,
    pub api_key: String,
    pub base_url: String,
    /// 该 provider 的默认模型别名
    pub default_model: String,
    /// key = 别名 (如 "sonnet"), value = 实际 model ID (如 "claude-sonnet-4-20250514")
    #[serde(default)]
    pub models: HashMap<String, String>,
}

impl ProviderConfig {
    /// 根据别名或原始 model ID 解析出实际的 model ID
    pub fn resolve_model(&self, name_or_id: &str) -> String {
        self.models
            .get(name_or_id)
            .cloned()
            .unwrap_or_else(|| name_or_id.to_string())
    }

    /// 解析该 provider 的默认模型为实际 model ID
    pub fn resolve_default_model(&self) -> String {
        self.resolve_model(&self.default_model)
    }
}

impl Config {
    pub fn load() -> Result<Self> {
        // Try config.toml in current dir, then fallback paths
        let candidates = ["config.toml", "config.local.toml"];
        for path in &candidates {
            if Path::new(path).exists() {
                let content = std::fs::read_to_string(path)
                    .with_context(|| format!("Failed to read {path}"))?;
                let config: Config =
                    toml::from_str(&content).with_context(|| format!("Failed to parse {path}"))?;
                return Ok(config);
            }
        }

        // Fallback: try CONFIG_PATH env var
        if let Ok(path) = std::env::var("CONFIG_PATH") {
            let content =
                std::fs::read_to_string(&path).with_context(|| format!("Failed to read {path}"))?;
            let config: Config =
                toml::from_str(&content).with_context(|| format!("Failed to parse {path}"))?;
            return Ok(config);
        }

        bail!("No config file found. Create config.toml from config.example.toml")
    }

    pub fn find_provider(&self, name: &str) -> Option<&ProviderConfig> {
        self.providers.iter().find(|p| p.name == name)
    }

    pub fn default_provider(&self) -> Option<&ProviderConfig> {
        self.find_provider(&self.server.default_provider)
    }
}
