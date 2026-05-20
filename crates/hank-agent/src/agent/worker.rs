use crate::agent::{Artifact, DelegatedTask, LoopDetector, TaskResult, TaskStatus};
use crate::context::summary::truncate_tool_result_default;
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
use tracing::{debug, warn};

const WORKER_MAX_ITERATIONS: usize = 25;
const LLM_STREAM_TIMEOUT_SECS: u64 = 120;
const TOOL_TIMEOUT_SECS: u64 = 30;
const LOOP_TERMINATE_COUNT: usize = 3;

/// WorkerAgent executes a delegated task using a flat stream-tools loop.
pub struct WorkerAgent {
    provider: Arc<dyn LlmProvider>,
    tools: Vec<Arc<dyn Tool>>,
    model: String,
    tool_definitions: Vec<ToolDefinition>,
}

impl WorkerAgent {
    pub fn new(
        provider: Arc<dyn LlmProvider>,
        tools: Vec<Arc<dyn Tool>>,
        model: String,
    ) -> Self {
        let tool_definitions = tools
            .iter()
            .map(|t| ToolDefinition {
                name: t.name().to_string(),
                description: t.description().to_string(),
                input_schema: t.input_schema(),
            })
            .collect();
        Self {
            provider,
            tools,
            model,
            tool_definitions,
        }
    }

    /// Execute a delegated task and return a TaskResult.
    pub async fn execute_task(
        &self,
        task: &DelegatedTask,
        event_tx: mpsc::Sender<AgentEvent>,
        cancel: CancellationToken,
    ) -> Result<TaskResult> {
        let system_prompt = format!(
            "You are a worker agent executing a specific sub-task.\n\
             Task: {}\n\
             Context: {}\n\
             Complete this task thoroughly. Report your findings clearly.",
            task.description, task.context
        );

        let mut messages = vec![Message {
            role: Role::User,
            content: vec![ContentBlock::Text {
                text: task.description.clone(),
            }],
        }];

        let mut artifacts = Vec::new();
        let mut final_text = String::new();
        let mut consecutive_max_tokens = 0u32;
        let mut loop_detector = LoopDetector::new();

        for iteration in 0..WORKER_MAX_ITERATIONS {
            if cancel.is_cancelled() {
                break;
            }

            let req = CompletionRequest {
                model: self.model.clone(),
                system: Some(system_prompt.clone()),
                messages: messages.clone(),
                tools: self.tool_definitions.clone(),
                max_tokens: 8192,
            };

            debug!("Worker iteration {iteration} for task {}", task.id);

            let _ = event_tx.send(AgentEvent::LlmRequest {
                model: req.model.clone(),
                system: req.system.clone(),
                tools: req.tools.iter().map(|t| t.name.clone()).collect(),
                max_tokens: req.max_tokens,
                message_count: req.messages.len(),
                phase: "worker".to_string(),
            }).await;

            let mut stream = stream_with_retry(&self.provider, req).await?;
            let mut assistant_content: Vec<ContentBlock> = Vec::new();
            let mut current_text = String::new();
            let mut current_tool_id = String::new();
            let mut current_tool_name = String::new();
            let mut current_tool_input = String::new();
            let mut stop_reason = StopReason::EndTurn;
            let mut in_tool_block = false;
            let mut cancelled = false;

            loop {
                let event = tokio::select! {
                    event = stream.next() => event,
                    _ = cancel.cancelled() => { cancelled = true; None }
                    _ = tokio::time::sleep(Duration::from_secs(LLM_STREAM_TIMEOUT_SECS)) => {
                        warn!("Worker LLM stream timeout after {}s for task {}", LLM_STREAM_TIMEOUT_SECS, task.id);
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
                        return Ok(TaskResult {
                            task_id: task.id.clone(),
                            status: TaskStatus::Failed,
                            summary: format!("Stream error: {e}"),
                            artifacts: vec![],
                        });
                    }
                }
            }

            if !current_text.is_empty() {
                assistant_content.push(ContentBlock::Text {
                    text: std::mem::take(&mut current_text),
                });
            }

            // Collect final text for summary
            for block in &assistant_content {
                if let ContentBlock::Text { text } = block {
                    final_text = text.clone();
                }
            }

            messages.push(Message {
                role: Role::Assistant,
                content: assistant_content.clone(),
            });

            if cancelled {
                break;
            }

            // Handle MaxTokens: continue generation instead of stopping
            if stop_reason == StopReason::MaxTokens {
                warn!("Worker MaxTokens hit at iteration {iteration} for task {}", task.id);
                consecutive_max_tokens += 1;
                if consecutive_max_tokens >= 3 {
                    warn!("Worker: 3 consecutive MaxTokens without tool use, treating as done");
                    break;
                }
                // Inject continuation prompt
                messages.push(Message {
                    role: Role::User,
                    content: vec![ContentBlock::Text {
                        text: "[Your previous response was cut off. Continue from where you left off.]".to_string(),
                    }],
                });
                continue;
            }

            if stop_reason == StopReason::ToolUse {
                consecutive_max_tokens = 0;
                let mut tool_results: Vec<ContentBlock> = Vec::new();
                for block in &assistant_content {
                    if let ContentBlock::ToolUse { id, name, input } = block {
                        if cancel.is_cancelled() {
                            return Ok(TaskResult {
                                task_id: task.id.clone(),
                                status: TaskStatus::Failed,
                                summary: "Cancelled".to_string(),
                                artifacts: vec![],
                            });
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

                            if loop_detector.consecutive_loops >= LOOP_TERMINATE_COUNT {
                                warn!(
                                    "Worker loop detection: {} consecutive loops, terminating task {}",
                                    loop_detector.consecutive_loops, task.id
                                );
                                return Ok(TaskResult {
                                    task_id: task.id.clone(),
                                    status: TaskStatus::Failed,
                                    summary: format!("Loop detected: {}. Task terminated.", pattern),
                                    artifacts,
                                });
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
                            messages.push(nudge);
                        }

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
                                warn!("Worker tool {} timed out after {}s for task {}", name, TOOL_TIMEOUT_SECS, task.id);
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

                        // Collect artifacts from tool outputs
                        if !output.is_error {
                            artifacts.push(Artifact {
                                kind: name.clone(),
                                description: format!("Output from {name}"),
                                content: output.content.clone(),
                            });
                        }

                        let content = truncate_tool_result_default(&output.content);
                        tool_results.push(ContentBlock::ToolResult {
                            tool_use_id: id.clone(),
                            content,
                            is_error: output.is_error,
                        });
                    }
                }
                messages.push(Message {
                    role: Role::User,
                    content: tool_results,
                });
            } else {
                break;
            }

            if iteration == WORKER_MAX_ITERATIONS - 1 {
                warn!("Worker reached max iterations for task {}", task.id);
            }
        }

        // Truncate summary to reasonable length
        let summary = if final_text.len() > 500 {
            format!("{}...", &final_text[..500])
        } else {
            final_text
        };

        Ok(TaskResult {
            task_id: task.id.clone(),
            status: TaskStatus::Success,
            summary,
            artifacts,
        })
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
