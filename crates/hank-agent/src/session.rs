use crate::agent::orchestrator::OrchestratorAgent;
use crate::agent::{LoopDetector, ThinkStrategy};
use crate::context::summary::{estimate_tokens, truncate_tool_result_default};
use crate::context::ContextManager;
use crate::retry::stream_with_retry;
use crate::AgentEvent;
use anyhow::Result;
use hank_provider::{
    CompletionRequest, ContentBlock, LlmProvider, Message, Role, StopReason, StreamEvent,
    ToolDefinition,
};
use hank_web_tools::{Tool, ToolOutput};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio_stream::StreamExt;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, warn};

const MAX_ITERATIONS: usize = 25;
const LLM_STREAM_TIMEOUT_SECS: u64 = 120;
const TOOL_TIMEOUT_SECS: u64 = 30;

/// Agent execution mode
pub enum AgentMode {
    /// Simple flat loop (backward compatible, for simple queries)
    Simple,
    /// Orchestrated multi-agent with Think/Act/Observe
    Orchestrated { think_strategy: ThinkStrategy },
}

impl Default for AgentMode {
    fn default() -> Self {
        Self::Simple
    }
}

pub struct AgentSession {
    provider: Arc<dyn LlmProvider>,
    tools: Vec<Arc<dyn Tool>>,
    messages: Vec<Message>,
    system_prompt: String,
    model: String,
    tool_definitions: Vec<ToolDefinition>,
    mode: AgentMode,
    context_manager: ContextManager,
}

impl AgentSession {
    pub fn new(
        provider: Arc<dyn LlmProvider>,
        tools: Vec<Arc<dyn Tool>>,
        model: String,
        system_prompt: String,
    ) -> Self {
        let tool_definitions = tools
            .iter()
            .map(|t| ToolDefinition {
                name: t.name().to_string(),
                description: t.description().to_string(),
                input_schema: t.input_schema(),
            })
            .collect();
        let context_manager = ContextManager::with_provider(80_000, provider.clone(), model.clone());
        Self {
            provider,
            tools,
            messages: Vec::new(),
            system_prompt,
            model,
            tool_definitions,
            mode: AgentMode::Simple,
            context_manager,
        }
    }

    /// Create a session with orchestrated mode
    pub fn orchestrated(
        provider: Arc<dyn LlmProvider>,
        tools: Vec<Arc<dyn Tool>>,
        model: String,
        system_prompt: String,
        think_strategy: ThinkStrategy,
    ) -> Self {
        let tool_definitions = tools
            .iter()
            .map(|t| ToolDefinition {
                name: t.name().to_string(),
                description: t.description().to_string(),
                input_schema: t.input_schema(),
            })
            .collect();
        let context_manager = ContextManager::with_provider(80_000, provider.clone(), model.clone());
        Self {
            provider,
            tools,
            messages: Vec::new(),
            system_prompt,
            model,
            tool_definitions,
            mode: AgentMode::Orchestrated { think_strategy },
            context_manager,
        }
    }

    pub fn messages(&self) -> &[Message] {
        &self.messages
    }

    pub fn set_messages(&mut self, messages: Vec<Message>) {
        self.messages = messages;
    }

    /// Run the agent loop, dispatching based on mode.
    pub async fn run(
        &mut self,
        user_content: Vec<ContentBlock>,
        event_tx: mpsc::Sender<AgentEvent>,
        cancel: CancellationToken,
    ) -> Result<()> {
        match &self.mode {
            AgentMode::Simple => {
                self.run_simple(user_content, event_tx, cancel).await
            }
            AgentMode::Orchestrated { think_strategy } => {
                let think_strategy = think_strategy.clone();
                self.run_orchestrated(user_content, event_tx, cancel, think_strategy)
                    .await
            }
        }
    }

    /// Orchestrated mode: delegate to OrchestratorAgent
    async fn run_orchestrated(
        &mut self,
        user_content: Vec<ContentBlock>,
        event_tx: mpsc::Sender<AgentEvent>,
        cancel: CancellationToken,
        think_strategy: ThinkStrategy,
    ) -> Result<()> {
        let mut orchestrator = OrchestratorAgent::new(
            self.provider.clone(),
            self.tools.clone(),
            self.model.clone(),
            self.system_prompt.clone(),
            think_strategy,
        );
        orchestrator.set_messages(std::mem::take(&mut self.messages));
        let result = orchestrator.run(user_content, event_tx, cancel).await;
        self.messages = orchestrator.messages().to_vec();
        result
    }

    /// Simple mode: flat stream → tools → loop (original behavior)
    async fn run_simple(
        &mut self,
        user_content: Vec<ContentBlock>,
        event_tx: mpsc::Sender<AgentEvent>,
        cancel: CancellationToken,
    ) -> Result<()> {
        self.messages.push(Message {
            role: Role::User,
            content: user_content,
        });

        let mut consecutive_max_tokens = 0u32;
        let mut loop_detector = LoopDetector::new();

        for iteration in 0..MAX_ITERATIONS {
            if cancel.is_cancelled() {
                let _ = event_tx.send(AgentEvent::TurnComplete).await;
                break;
            }

            let req = CompletionRequest {
                model: self.model.clone(),
                system: Some(self.system_prompt.clone()),
                messages: self.messages.clone(),
                tools: self.tool_definitions.clone(),
                max_tokens: 16384,
            };

            debug!("Agent loop iteration {iteration}: model={}, messages={}", req.model, req.messages.len());

            let llm_start = Instant::now();
            let mut stream = stream_with_retry(&self.provider, req).await?;

            let mut assistant_content: Vec<ContentBlock> = Vec::new();
            let mut current_text = String::new();
            let mut current_tool_id = String::new();
            let mut current_tool_name = String::new();
            let mut current_tool_input = String::new();
            let mut stop_reason = StopReason::EndTurn;
            let mut in_tool_block = false;
            let mut cancelled_during_stream = false;
            let mut total_input_tokens: u32 = 0;
            let mut total_output_tokens: u32 = 0;

            loop {
                let event = tokio::select! {
                    event = stream.next() => event,
                    _ = cancel.cancelled() => {
                        cancelled_during_stream = true;
                        None
                    }
                    _ = tokio::time::sleep(Duration::from_secs(LLM_STREAM_TIMEOUT_SECS)) => {
                        warn!("LLM stream timeout after {}s at iteration {}", LLM_STREAM_TIMEOUT_SECS, iteration);
                        None
                    }
                };
                let Some(event) = event else { break };
                match event {
                    Ok(StreamEvent::TextDelta(text)) => {
                        current_text.push_str(&text);
                        let _ = event_tx.send(AgentEvent::TextDelta { text }).await;
                    }
                    Ok(StreamEvent::ToolUseStart { id, name }) => {
                        debug!("ToolUseStart: id={id}, name={name}");
                        if !current_text.is_empty() {
                            assistant_content.push(ContentBlock::Text {
                                text: std::mem::take(&mut current_text),
                            });
                        }
                        current_tool_id = id;
                        current_tool_name = name;
                        current_tool_input.clear();
                        in_tool_block = true;
                    }
                    Ok(StreamEvent::ToolUseInputDelta(json)) => {
                        current_tool_input.push_str(&json);
                    }
                    Ok(StreamEvent::ToolUseEnd) => {
                        if !in_tool_block {
                            continue;
                        }
                        in_tool_block = false;
                        debug!("ToolUseEnd: id={current_tool_id}, name={current_tool_name}");
                        let input: serde_json::Value =
                            serde_json::from_str(&current_tool_input).unwrap_or_default();
                        assistant_content.push(ContentBlock::ToolUse {
                            id: std::mem::take(&mut current_tool_id),
                            name: std::mem::take(&mut current_tool_name),
                            input,
                        });
                        current_tool_input.clear();
                    }
                    Ok(StreamEvent::MessageEnd { stop_reason: sr }) => {
                        stop_reason = sr;
                    }
                    Ok(StreamEvent::Usage { input_tokens, output_tokens }) => {
                        total_input_tokens += input_tokens;
                        total_output_tokens += output_tokens;
                    }
                    Ok(StreamEvent::Error(msg)) => {
                        let _ = event_tx
                            .send(AgentEvent::Error { message: msg })
                            .await;
                    }
                    Err(e) => {
                        error!("Stream error: {e}");
                        let _ = event_tx
                            .send(AgentEvent::Error {
                                message: e.to_string(),
                            })
                            .await;
                        return Err(e);
                    }
                }
            }

            // Flush remaining text
            if !current_text.is_empty() {
                assistant_content.push(ContentBlock::Text {
                    text: std::mem::take(&mut current_text),
                });
            }

            // Emit LLM metrics
            let latency_ms = llm_start.elapsed().as_millis() as u64;
            let _ = event_tx.send(AgentEvent::Metrics {
                input_tokens: total_input_tokens,
                output_tokens: total_output_tokens,
                latency_ms,
                model: self.model.clone(),
                provider: self.provider.name().to_string(),
                phase: Some("simple".to_string()),
            }).await;

            self.messages.push(Message {
                role: Role::Assistant,
                content: assistant_content.clone(),
            });

            // 更新实际 token 用量（provider 报告的 input_tokens 是整个上下文的大小）
            if total_input_tokens > 0 {
                self.context_manager.update_actual_tokens(total_input_tokens as usize);
            }

            // Check budget after receiving assistant message
            match self.context_manager.check_budget(&self.messages) {
                crate::context::BudgetStatus::Overflow100 => {
                    warn!("Budget overflow, terminating at iteration {}", iteration);
                    let _ = event_tx.send(AgentEvent::TurnComplete).await;
                    break;
                }
                crate::context::BudgetStatus::Critical95 => {
                    let used = estimate_tokens(&self.messages);
                    let _ = event_tx
                        .send(AgentEvent::TokenWarning {
                            used_tokens: used,
                            total_budget: 200_000,
                            percent: 95,
                            action: "forcing_compression".to_string(),
                        })
                        .await;
                    if let Some(strategy) = self.context_manager.compress_async(&mut self.messages).await {
                        let after = estimate_tokens(&self.messages);
                        let _ = event_tx
                            .send(AgentEvent::CompressionTriggered {
                                before_tokens: used,
                                after_tokens: after,
                                strategy: format!("{:?}", strategy),
                            })
                            .await;
                    }
                }
                _ => {}
            }

            // If cancelled during streaming, stop immediately
            if cancelled_during_stream {
                let _ = event_tx.send(AgentEvent::TurnComplete).await;
                break;
            }

            // Handle MaxTokens: continue generation instead of stopping
            if stop_reason == StopReason::MaxTokens {
                warn!("MaxTokens hit at iteration {iteration}, continuing generation");
                consecutive_max_tokens += 1;
                if consecutive_max_tokens >= 3 {
                    warn!("3 consecutive MaxTokens without tool use, treating as done");
                    let _ = event_tx.send(AgentEvent::TurnComplete).await;
                    break;
                }
                // Note: if in_tool_block was true, the partial tool call was never
                // pushed to assistant_content, so it's already discarded.
                // Assistant content already pushed above; inject continuation prompt
                self.messages.push(Message {
                    role: Role::User,
                    content: vec![ContentBlock::Text {
                        text: "[Your previous response was cut off. Continue from where you left off.]".to_string(),
                    }],
                });
                continue;
            }

            // If stop reason is tool_use, execute tools and loop
            if stop_reason == StopReason::ToolUse {
                consecutive_max_tokens = 0;
                let mut tool_results: Vec<ContentBlock> = Vec::new();
                let mut ask_user_triggered = false;

                for block in &assistant_content {
                    if let ContentBlock::ToolUse { id, name, input } = block {
                        // Check cancellation before each tool
                        if cancel.is_cancelled() {
                            let _ = event_tx.send(AgentEvent::TurnComplete).await;
                            return Ok(());
                        }

                        // Detect ask_user tool — emit event and break
                        if name == "ask_user" {
                            let question = input["question"].as_str().unwrap_or_default().to_string();
                            let options = input["options"].as_array()
                                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                                .unwrap_or_default();
                            let _ = event_tx.send(AgentEvent::AskUser {
                                question,
                                options,
                                tool_use_id: id.clone(),
                            }).await;
                            ask_user_triggered = true;
                            break;
                        }

                        // Check for loop detection
                        if loop_detector.record(name, input) {
                            loop_detector.consecutive_loops += 1;
                            let pattern = loop_detector.loop_pattern();
                            let _ = event_tx
                                .send(AgentEvent::LoopDetected {
                                    pattern: pattern.clone(),
                                    window_size: 6,
                                })
                                .await;

                            if loop_detector.consecutive_loops >= 3 {
                                warn!("Loop detected: {} consecutive loops, terminating", loop_detector.consecutive_loops);
                                tool_results.push(ContentBlock::ToolResult {
                                    tool_use_id: id.clone(),
                                    content: format!(
                                        "Loop detected: {}. Agent terminating to prevent infinite loop.",
                                        pattern
                                    ),
                                    is_error: true,
                                });
                                break;
                            }

                            // Inject nudge message after this tool result
                        }

                        let input_str = serde_json::to_string(input).unwrap_or_default();
                        debug!("Executing tool: name={name}, id={id}");
                        let _ = event_tx
                            .send(AgentEvent::ToolStart {
                                id: id.clone(),
                                name: name.clone(),
                                input: input_str,
                            })
                            .await;
                        let tool_start = Instant::now();
                        let output = match tokio::time::timeout(
                            Duration::from_secs(TOOL_TIMEOUT_SECS),
                            self.execute_tool(name, input.clone()),
                        )
                        .await
                        {
                            Ok(tool_output) => tool_output,
                            Err(_) => {
                                warn!("Tool {} timed out after {}s", name, TOOL_TIMEOUT_SECS);
                                ToolOutput {
                                    content: format!("Tool execution timed out after {}s", TOOL_TIMEOUT_SECS),
                                    is_error: true,
                                }
                            }
                        };
                        let tool_duration_ms = tool_start.elapsed().as_millis() as u64;
                        debug!("Tool result: id={id}, is_error={}", output.is_error);
                        let _ = event_tx
                            .send(AgentEvent::ToolResult {
                                id: id.clone(),
                                content: output.content.clone(),
                                is_error: output.is_error,
                            })
                            .await;
                        let _ = event_tx
                            .send(AgentEvent::ToolMetrics {
                                tool_name: name.clone(),
                                duration_ms: tool_duration_ms,
                                is_error: output.is_error,
                            })
                            .await;
                        let content = truncate_tool_result_default(&output.content);
                        tool_results.push(ContentBlock::ToolResult {
                            tool_use_id: id.clone(),
                            content,
                            is_error: output.is_error,
                        });
                    }
                }

                // If ask_user was triggered, break the agent loop (don't push tool results)
                if ask_user_triggered {
                    let _ = event_tx.send(AgentEvent::TurnComplete).await;
                    break;
                }

                self.messages.push(Message {
                    role: Role::User,
                    content: tool_results,
                });

                // Budget check after tool results to catch large tool outputs
                match self.context_manager.check_budget(&self.messages) {
                    crate::context::BudgetStatus::Overflow100 => {
                        warn!("Budget overflow after tool results, terminating");
                        let _ = event_tx.send(AgentEvent::TurnComplete).await;
                        break;
                    }
                    crate::context::BudgetStatus::Critical95 => {
                        let used = estimate_tokens(&self.messages);
                        if let Some(strategy) = self.context_manager.compress_async(&mut self.messages).await {
                            let after = estimate_tokens(&self.messages);
                            let _ = event_tx
                                .send(AgentEvent::CompressionTriggered {
                                    before_tokens: used,
                                    after_tokens: after,
                                    strategy: format!("{:?}", strategy),
                                })
                                .await;
                        }
                    }
                    _ => {}
                }
            } else {
                // Turn complete
                let _ = event_tx.send(AgentEvent::TurnComplete).await;
                break;
            }

            if iteration == MAX_ITERATIONS - 1 {
                warn!("Agent loop reached max iterations ({MAX_ITERATIONS})");
                let _ = event_tx.send(AgentEvent::TurnComplete).await;
            }
        }

        Ok(())
    }

    async fn execute_tool(&self, name: &str, input: serde_json::Value) -> ToolOutput {
        for tool in &self.tools {
            if tool.name() == name {
                return match tool.execute(input).await {
                    Ok(output) => output,
                    Err(e) => ToolOutput {
                        content: format!("Tool execution error: {e}"),
                        is_error: true,
                    },
                };
            }
        }
        ToolOutput {
            content: format!("Unknown tool: {name}"),
            is_error: true,
        }
    }
}
