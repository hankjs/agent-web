pub mod claude_code;
pub mod codex;

use super::provider::CliProvider;

/// Create a provider instance by agent type identifier.
pub fn create_provider(agent_type: &str) -> Result<Box<dyn CliProvider>, String> {
    match agent_type {
        "claude-code" => Ok(Box::new(claude_code::ClaudeCodeProvider::new())),
        "codex" => Ok(Box::new(codex::CodexProvider::new())),
        _ => Err(format!("Unknown agent type: {}", agent_type)),
    }
}
