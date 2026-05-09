use crate::agent::{TaskStatus, Verdict};
use serde::{Deserialize, Serialize};

/// Events emitted by the agent loop to the caller (SSE stream)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    TextDelta { text: String },
    ToolStart { id: String, name: String, input: String },
    ToolResult { id: String, content: String, is_error: bool },
    TurnComplete,
    Error { message: String },
    /// Orchestrator Think phase output
    Thinking { text: String },
    /// A worker agent was spawned
    WorkerSpawned { task_id: String, description: String },
    /// A worker agent completed
    WorkerCompleted { task_id: String, status: TaskStatus, summary: String },
    /// Verification result from the Verifier
    Verification { verdict: Verdict, issues: Vec<String> },
    /// LLM call metrics (token usage + latency)
    Metrics {
        input_tokens: u32,
        output_tokens: u32,
        latency_ms: u64,
        model: String,
        provider: String,
    },
    /// Tool execution metrics
    ToolMetrics {
        tool_name: String,
        duration_ms: u64,
        is_error: bool,
    },
    /// Provider fallback occurred during chat
    ProviderFallback {
        from: String,
        to: String,
        reason: String,
    },
}
