use crate::agent::traits::{DelegatedTask, TaskResult, TaskStatus, ThinkStrategy};
use crate::agent::worker::WorkerAgent;
use crate::agent::LoopDetector;
use crate::context::summary::{estimate_tokens, truncate_tool_result_default};
use crate::context::{BudgetStatus, ContextManager};
use crate::retry::stream_with_retry;
use crate::AgentEvent;
use anyhow::Result;
use hank_provider::{
    CompletionRequest, ContentBlock, LlmProvider, Message, Role, StopReason, StreamEvent,
    ToolDefinition,
};
use hank_web_tools::{Tool, ToolOutput};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_stream::StreamExt;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, warn};

const ORCHESTRATOR_MAX_ITERATIONS: usize = 50;
const DELEGATE_TASK_TOOL: &str = "delegate_task";
const LLM_STREAM_TIMEOUT_SECS: u64 = 120;
const TOOL_TIMEOUT_SECS: u64 = 30;
const LOOP_TERMINATE_COUNT: usize = 3;

pub struct OrchestratorAgent {
    provider: Arc<dyn LlmProvider>,
    tools: Vec<Arc<dyn Tool>>,
    model: String,
    system_prompt: String,
    tool_definitions: Vec<ToolDefinition>,
    think_strategy: ThinkStrategy,
    context_manager: ContextManager,
    loop_detector: LoopDetector,
    messages: Vec<Message>,
    consecutive_max_tokens: u32,
}

impl OrchestratorAgent {
    pub fn new(
        provider: Arc<dyn LlmProvider>,
        tools: Vec<Arc<dyn Tool>>,
        model: String,
        system_prompt: String,
        think_strategy: ThinkStrategy,
    ) -> Self {
        let mut tool_definitions: Vec<ToolDefinition> = tools
            .iter()
            .map(|t| ToolDefinition {
                name: t.name().to_string(),
                description: t.description().to_string(),
                input_schema: t.input_schema(),
            })
            .collect();

        // Add the delegate_task pseudo-tool
        tool_definitions.push(ToolDefinition {
            name: DELEGATE_TASK_TOOL.to_string(),
            description: "Delegate a sub-task to a worker agent. The worker will execute \
                the task independently and return a summary."
                .to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "description": {
                        "type": "string",
                        "description": "What the worker should accomplish"
                    },
                    "context": {
                        "type": "string",
                        "description": "Relevant context for the worker"
                    },
                    "tools_allowed": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Which tools the worker can use"
                    },
                    "affected_paths": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "File paths this task may modify"
                    }
                },
                "required": ["description", "context", "tools_allowed"]
            }),
        });

        let context_manager = ContextManager::with_provider(80_000, provider.clone(), model.clone());

        Self {
            provider,
            tools,
            model,
            system_prompt,
            tool_definitions,
            think_strategy,
            context_manager,
            loop_detector: LoopDetector::new(),
            messages: Vec::new(),
            consecutive_max_tokens: 0,
        }
    }

    pub fn messages(&self) -> &[Message] {
        &self.messages
    }

    pub fn set_messages(&mut self, messages: Vec<Message>) {
        self.messages = messages;
    }

    /// Run the orchestrator loop with Think/Act/Observe phases.
    pub async fn run(
        &mut self,
        user_content: Vec<ContentBlock>,
        event_tx: mpsc::Sender<AgentEvent>,
        cancel: CancellationToken,
    ) -> Result<()> {
        self.messages.push(Message {
            role: Role::User,
            content: user_content,
        });

        let mut _iterations_without_progress = 0;
        let mut last_worker_failed = false;

        for iteration in 0..ORCHESTRATOR_MAX_ITERATIONS {
            if cancel.is_cancelled() {
                let _ = event_tx.send(AgentEvent::TurnComplete).await;
                break;
            }

            // Budget check with multi-level strategy
            match self.context_manager.check_budget(&self.messages) {
                BudgetStatus::Overflow100 => {
                    warn!("Budget overflow at 100%, terminating agent loop");
                    let _ = event_tx.send(AgentEvent::TurnComplete).await;
                    break;
                }
                BudgetStatus::Critical95 => {
                    warn!("Budget critical at 95%, forcing compression");
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
                BudgetStatus::Warning80 => {
                    let used = estimate_tokens(&self.messages);
                    debug!("Budget warning at 80%, compressing if needed");
                    let _ = event_tx
                        .send(AgentEvent::TokenWarning {
                            used_tokens: used,
                            total_budget: 200_000,
                            percent: 80,
                            action: "compress_if_needed".to_string(),
                        })
                        .await;
                    if self.context_manager.needs_compression(&self.messages) {
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
                }
                BudgetStatus::Normal => {
                    // No action needed
                }
            }

            // THINK phase (conditional)
            if self.should_think(iteration, last_worker_failed) {
                self.think_phase(&event_tx, &cancel).await?;
                if cancel.is_cancelled() {
                    let _ = event_tx.send(AgentEvent::TurnComplete).await;
                    break;
                }
            }

            // ACT phase
            let act_result = self.act_phase(&event_tx, &cancel).await?;
            if cancel.is_cancelled() {
                let _ = event_tx.send(AgentEvent::TurnComplete).await;
                break;
            }

            match act_result {
                ActResult::Done => {
                    let _ = event_tx.send(AgentEvent::TurnComplete).await;
                    break;
                }
                ActResult::Continue => {
                    _iterations_without_progress += 1;
                    last_worker_failed = false;
                }
                ActResult::WorkerCompleted { success } => {
                    _iterations_without_progress = 0;
                    last_worker_failed = !success;
                }
            }

            if iteration == ORCHESTRATOR_MAX_ITERATIONS - 1 {
                warn!("Orchestrator reached max iterations");
                let _ = event_tx.send(AgentEvent::TurnComplete).await;
            }
        }

        Ok(())
    }

    fn should_think(&self, iteration: usize, last_worker_failed: bool) -> bool {
        match &self.think_strategy {
            ThinkStrategy::Always => true,
            ThinkStrategy::Never => false,
            ThinkStrategy::Conditional => {
                iteration == 0 || last_worker_failed
            }
        }
    }

    /// Think phase: call LLM without tools to get structured reasoning.
    async fn think_phase(
        &mut self,
        event_tx: &mpsc::Sender<AgentEvent>,
        cancel: &CancellationToken,
    ) -> Result<()> {
        let req = CompletionRequest {
            model: self.model.clone(),
            system: Some(format!(
                "{}\n\nYou are in THINK mode. Analyze the situation and plan your next steps. \
                 Do NOT use tools. Just reason about what to do next.",
                self.system_prompt
            )),
            messages: self.messages.clone(),
            tools: vec![], // No tools in think phase
            max_tokens: 2048,
        };

        let _ = event_tx.send(AgentEvent::LlmRequest {
            model: req.model.clone(),
            system: req.system.clone(),
            tools: req.tools.iter().map(|t| t.name.clone()).collect(),
            max_tokens: req.max_tokens,
            message_count: req.messages.len(),
            phase: "think".to_string(),
        }).await;

        debug!("Orchestrator THINK phase");
        let mut stream = stream_with_retry(&self.provider, req).await?;
        let mut think_text = String::new();

        loop {
            let event = tokio::select! {
                event = stream.next() => event,
                _ = cancel.cancelled() => { None }
                _ = tokio::time::sleep(Duration::from_secs(LLM_STREAM_TIMEOUT_SECS)) => {
                    warn!("Think phase LLM stream timeout after {}s", LLM_STREAM_TIMEOUT_SECS);
                    None
                }
            };
            let Some(event) = event else { break };
            match event {
                Ok(StreamEvent::TextDelta(text)) => {
                    think_text.push_str(&text);
                    let _ = event_tx
                        .send(AgentEvent::Thinking { text })
                        .await;
                }
                Ok(StreamEvent::MessageEnd { .. }) => break,
                Ok(StreamEvent::Error(msg)) => {
                    let _ = event_tx.send(AgentEvent::Error { message: msg }).await;
                    break;
                }
                Err(e) => {
                    error!("Think phase stream error: {e}");
                    break;
                }
                _ => {}
            }
        }

        // Add think output to messages as assistant turn
        if !think_text.is_empty() {
            self.messages.push(Message {
                role: Role::Assistant,
                content: vec![ContentBlock::Text { text: think_text }],
            });
        }

        Ok(())
    }

    /// Act phase: call LLM with tools, execute tools or delegate.
    async fn act_phase(
        &mut self,
        event_tx: &mpsc::Sender<AgentEvent>,
        cancel: &CancellationToken,
    ) -> Result<ActResult> {
        let req = CompletionRequest {
            model: self.model.clone(),
            system: Some(self.system_prompt.clone()),
            messages: self.messages.clone(),
            tools: self.tool_definitions.clone(),
            max_tokens: 16384,
        };

        let _ = event_tx.send(AgentEvent::LlmRequest {
            model: req.model.clone(),
            system: req.system.clone(),
            tools: req.tools.iter().map(|t| t.name.clone()).collect(),
            max_tokens: req.max_tokens,
            message_count: req.messages.len(),
            phase: "act".to_string(),
        }).await;

        debug!("Orchestrator ACT phase");
        let mut stream = stream_with_retry(&self.provider, req).await?;

        let mut assistant_content: Vec<ContentBlock> = Vec::new();
        let mut current_text = String::new();
        let mut current_tool_id = String::new();
        let mut current_tool_name = String::new();
        let mut current_tool_input = String::new();
        let mut stop_reason = StopReason::EndTurn;
        let mut in_tool_block = false;

        loop {
            let event = tokio::select! {
                event = stream.next() => event,
                _ = cancel.cancelled() => { None }
                _ = tokio::time::sleep(Duration::from_secs(LLM_STREAM_TIMEOUT_SECS)) => {
                    warn!("Act phase LLM stream timeout after {}s", LLM_STREAM_TIMEOUT_SECS);
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
                    if !in_tool_block { continue; }
                    in_tool_block = false;
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
                Ok(StreamEvent::Error(msg)) => {
                    let _ = event_tx.send(AgentEvent::Error { message: msg }).await;
                }
                Ok(_) => {}
                Err(e) => {
                    error!("Act phase stream error: {e}");
                    return Err(e);
                }
            }
        }

        if !current_text.is_empty() {
            assistant_content.push(ContentBlock::Text {
                text: std::mem::take(&mut current_text),
            });
        }

        self.messages.push(Message {
            role: Role::Assistant,
            content: assistant_content.clone(),
        });

        // Handle MaxTokens: continue generation instead of stopping
        if stop_reason == StopReason::MaxTokens {
            warn!("Orchestrator MaxTokens hit, continuing generation");
            self.consecutive_max_tokens += 1;
            if self.consecutive_max_tokens >= 3 {
                warn!("3 consecutive MaxTokens without tool use, treating as done");
                return Ok(ActResult::Done);
            }
            // Inject continuation prompt
            self.messages.push(Message {
                role: Role::User,
                content: vec![ContentBlock::Text {
                    text: "[Your previous response was cut off. Continue from where you left off.]".to_string(),
                }],
            });
            return Ok(ActResult::Continue);
        }

        // Reset counter on successful tool use
        self.consecutive_max_tokens = 0;

        if stop_reason != StopReason::ToolUse {
            return Ok(ActResult::Done);
        }

        // Execute tools, intercepting delegate_task
        let mut tool_results: Vec<ContentBlock> = Vec::new();
        let mut had_worker = false;
        let mut worker_success = true;

        for block in &assistant_content {
            if let ContentBlock::ToolUse { id, name, input } = block {
                if cancel.is_cancelled() {
                    return Ok(ActResult::Done);
                }

                // Check for loop detection
                if self.loop_detector.record(name, input) {
                    self.loop_detector.consecutive_loops += 1;
                    let pattern = self.loop_detector.loop_pattern();
                    let _ = event_tx
                        .send(AgentEvent::LoopDetected {
                            pattern: pattern.clone(),
                            window_size: 6,
                        })
                        .await;

                    if self.loop_detector.consecutive_loops >= LOOP_TERMINATE_COUNT {
                        warn!(
                            "Loop detection: {} consecutive loops, terminating",
                            self.loop_detector.consecutive_loops
                        );
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

                    // Inject nudge message
                    let nudge = Message {
                        role: Role::User,
                        content: vec![ContentBlock::Text {
                            text: format!(
                                "⚠️ Loop detected: {}. Vary your approach or use different tools.",
                                pattern
                            ),
                        }],
                    };
                    self.messages.push(nudge);
                }

                if name == DELEGATE_TASK_TOOL {
                    // Intercept and spawn worker
                    let result = self
                        .handle_delegate_task(id, input, event_tx, cancel)
                        .await?;
                    had_worker = true;
                    if result.status != TaskStatus::Success {
                        worker_success = false;
                    }
                    tool_results.push(ContentBlock::ToolResult {
                        tool_use_id: id.clone(),
                        content: format!(
                            "Task {} completed with status {:?}.\nSummary: {}",
                            result.task_id, result.status, result.summary
                        ),
                        is_error: result.status == TaskStatus::Failed,
                    });
                } else {
                    // Execute directly with timeout
                    let input_str = serde_json::to_string(input).unwrap_or_default();
                    let _ = event_tx
                        .send(AgentEvent::ToolStart {
                            id: id.clone(),
                            name: name.clone(),
                            input: input_str,
                        })
                        .await;

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

                    let _ = event_tx
                        .send(AgentEvent::ToolResult {
                            id: id.clone(),
                            content: output.content.clone(),
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
        }

        self.messages.push(Message {
            role: Role::User,
            content: tool_results,
        });

        // Budget check after tool results to catch large tool outputs early
        match self.context_manager.check_budget(&self.messages) {
            BudgetStatus::Overflow100 => {
                warn!("Budget overflow after tool results, terminating");
                return Ok(ActResult::Done);
            }
            BudgetStatus::Critical95 => {
                let used = estimate_tokens(&self.messages);
                if let Some(_strategy) = self.context_manager.compress_async(&mut self.messages).await {
                    let after = estimate_tokens(&self.messages);
                    let _ = event_tx
                        .send(AgentEvent::CompressionTriggered {
                            before_tokens: used,
                            after_tokens: after,
                            strategy: "post_tool_critical".to_string(),
                        })
                        .await;
                }
            }
            _ => {}
        }

        if had_worker {
            Ok(ActResult::WorkerCompleted { success: worker_success })
        } else {
            Ok(ActResult::Continue)
        }
    }

    async fn handle_delegate_task(
        &self,
        _tool_use_id: &str,
        input: &serde_json::Value,
        event_tx: &mpsc::Sender<AgentEvent>,
        cancel: &CancellationToken,
    ) -> Result<TaskResult> {
        let task = DelegatedTask {
            id: uuid::Uuid::new_v4().to_string(),
            description: input
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("unnamed task")
                .to_string(),
            context: input
                .get("context")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            tools_allowed: input
                .get("tools_allowed")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default(),
            affected_paths: input
                .get("affected_paths")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default(),
        };

        let _ = event_tx
            .send(AgentEvent::WorkerSpawned {
                task_id: task.id.clone(),
                description: task.description.clone(),
            })
            .await;

        // Filter tools for the worker
        let worker_tools: Vec<Arc<dyn Tool>> = self
            .tools
            .iter()
            .filter(|t| task.tools_allowed.contains(&t.name().to_string()))
            .cloned()
            .collect();

        let worker = WorkerAgent::new(
            self.provider.clone(),
            worker_tools,
            self.model.clone(),
        );

        let result = worker
            .execute_task(&task, event_tx.clone(), cancel.clone())
            .await?;

        let _ = event_tx
            .send(AgentEvent::WorkerCompleted {
                task_id: result.task_id.clone(),
                status: result.status.clone(),
                summary: result.summary.clone(),
            })
            .await;

        Ok(result)
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

enum ActResult {
    Done,
    Continue,
    WorkerCompleted { success: bool },
}
