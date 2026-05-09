use crate::AgentEvent;
use anyhow::Result;
use hank_provider::{
    CompletionRequest, ContentBlock, LlmProvider, Message, Role, StopReason, StreamEvent,
    ToolDefinition,
};
use hank_web_tools::{Tool, ToolOutput};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_stream::StreamExt;
use tracing::{debug, error, warn};

const MAX_ITERATIONS: usize = 25;

pub struct AgentSession {
    provider: Arc<dyn LlmProvider>,
    tools: Vec<Arc<dyn Tool>>,
    messages: Vec<Message>,
    system_prompt: String,
    model: String,
    tool_definitions: Vec<ToolDefinition>,
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
        Self {
            provider,
            tools,
            messages: Vec::new(),
            system_prompt,
            model,
            tool_definitions,
        }
    }

    pub fn messages(&self) -> &[Message] {
        &self.messages
    }

    pub fn set_messages(&mut self, messages: Vec<Message>) {
        self.messages = messages;
    }

    /// Run the agent loop: send user message, stream response, execute tools, repeat
    pub async fn run(
        &mut self,
        user_message: String,
        event_tx: mpsc::Sender<AgentEvent>,
    ) -> Result<()> {
        self.messages.push(Message {
            role: Role::User,
            content: vec![ContentBlock::Text { text: user_message }],
        });

        for iteration in 0..MAX_ITERATIONS {
            let req = CompletionRequest {
                model: self.model.clone(),
                system: Some(self.system_prompt.clone()),
                messages: self.messages.clone(),
                tools: self.tool_definitions.clone(),
                max_tokens: 4096,
            };

            debug!("Agent loop iteration {iteration}: model={}, messages={}", req.model, req.messages.len());

            let mut stream = self.provider.stream(req).await?;

            let mut assistant_content: Vec<ContentBlock> = Vec::new();
            let mut current_text = String::new();
            let mut current_tool_id = String::new();
            let mut current_tool_name = String::new();
            let mut current_tool_input = String::new();
            let mut stop_reason = StopReason::EndTurn;
            let mut in_tool_block = false;

            while let Some(event) = stream.next().await {
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

            self.messages.push(Message {
                role: Role::Assistant,
                content: assistant_content.clone(),
            });

            // If stop reason is tool_use, execute tools and loop
            if stop_reason == StopReason::ToolUse {
                let mut tool_results: Vec<ContentBlock> = Vec::new();

                for block in &assistant_content {
                    if let ContentBlock::ToolUse { id, name, input } = block {
                        let input_str = serde_json::to_string(input).unwrap_or_default();
                        debug!("Executing tool: name={name}, id={id}");
                        let _ = event_tx
                            .send(AgentEvent::ToolStart {
                                id: id.clone(),
                                name: name.clone(),
                                input: input_str,
                            })
                            .await;
                        let output = self.execute_tool(name, input.clone()).await;
                        debug!("Tool result: id={id}, is_error={}", output.is_error);
                        let _ = event_tx
                            .send(AgentEvent::ToolResult {
                                id: id.clone(),
                                content: output.content.clone(),
                                is_error: output.is_error,
                            })
                            .await;
                        tool_results.push(ContentBlock::ToolResult {
                            tool_use_id: id.clone(),
                            content: output.content,
                            is_error: output.is_error,
                        });
                    }
                }

                self.messages.push(Message {
                    role: Role::User,
                    content: tool_results,
                });
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
