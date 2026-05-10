use async_trait::async_trait;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::events::AcpEvent;

/// Information returned from a successful provider test.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProviderInfo {
    pub version: Option<String>,
    pub model: Option<String>,
}

/// Per-session state managed by the provider.
pub struct ProviderSession {
    pub work_dir: String,
    /// CLI-specific session identifier (e.g. Claude Code's session_id for --resume).
    pub cli_session_id: Option<String>,
}

/// Trait implemented by each CLI agent provider (Claude Code, Codex, etc.).
#[async_trait]
pub trait CliProvider: Send + Sync {
    /// Human-readable provider name.
    fn name(&self) -> &str;

    /// Test connectivity: run the binary and verify it responds.
    async fn test(&self, binary_path: &str, work_dir: &str) -> Result<ProviderInfo, String>;

    /// Send a prompt and stream events back via the channel.
    async fn prompt(
        &self,
        binary_path: &str,
        message: &str,
        session: &mut ProviderSession,
        event_tx: mpsc::Sender<AcpEvent>,
        cancel_token: CancellationToken,
    ) -> Result<(), String>;
}
