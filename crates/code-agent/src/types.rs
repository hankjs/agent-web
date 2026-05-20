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
    /// Loop detected in agent execution
    LoopDetected { pattern: String, window_size: usize },
    /// Token budget warning
    TokenWarning { used_tokens: usize, total_budget: usize, percent: u8, action: String },
    /// Compression triggered
    CompressionTriggered { before_tokens: usize, after_tokens: usize, strategy: String },
    /// LLM call metrics (token usage + latency)
    Metrics {
        input_tokens: u32,
        output_tokens: u32,
        latency_ms: u64,
        model: String,
        provider: String,
        phase: Option<String>,
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
    /// A spec was updated by agent tool
    SpecUpdated {
        spec_id: String,
        capability: String,
        version: i32,
    },
    /// A task status was updated by agent tool
    TaskUpdated {
        task_id: String,
        change_id: String,
        status: String,
    },
    /// An artifact was updated by agent tool
    ArtifactUpdated {
        artifact_id: String,
        change_id: String,
        #[serde(rename = "artifact_type")]
        artifact_type: String,
    },
    /// Agent is asking the user a question (interrupts agent loop)
    AskUser {
        question: String,
        options: Vec<String>,
        tool_use_id: String,
    },
    /// Explore phase completed for a change
    ExploreComplete {
        change_id: String,
        summary: String,
    },
    /// Generate phase completed for a change
    GenerateComplete {
        change_id: String,
        artifact_count: u32,
    },
    /// 每次 LLM 调用前 emit，记录请求参数
    LlmRequest {
        model: String,
        system: Option<String>,
        tools: Vec<String>,
        max_tokens: u32,
        message_count: usize,
        phase: String,
    },
    /// Streaming tool output delta (实时输出)
    ToolOutputDelta { id: String, chunk: String },
}
