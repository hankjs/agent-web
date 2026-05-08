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
use tracing::error;

pub struct AgentSession {
    provider: Arc<dyn LlmProvider>,
    tools: Vec<Arc<dyn Tool>>,
    messages: Vec<Message>,
    system_prompt: String,
    model: String,
}

impl AgentSession {
    pub fn new(
        provider: Arc<dyn LlmProvider>,
        tools: Vec<Arc<dyn Tool>>,
        model: String,
        system_prompt: String,
    ) -> Self {
        Self {
            provider,
            tools,
            messages: Vec::new(),
            system_prompt,
            model,
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
        // Add user message
        self.messages.push(Message {
            role: Role::User,
            content: vec![ContentBlock::Text { text: user_message }],
        });

        loop {
            let req = CompletionRequest {
                model: self.model.clone(),
                system: Some(self.system_prompt.clone()),
                messages: self.messages.clone(),
                tools: self.tool_definitions(),
                max_tokens: 4096,
            };

            let mut stream = self.provider.stream(req).await?;

            let mut assistant_content: Vec<ContentBlock> = Vec::new();
            let mut current_text = String::new();
            let mut current_tool_id = String::new();
            let mut current_tool_name = String::new();
            let mut current_tool_input = String::new();
            let mut stop_reason = StopReason::EndTurn;

            while let Some(event) = stream.next().await {
                match event {
                    Ok(StreamEvent::TextDelta(text)) => {
                        current_text.push_str(&text);
                        let _ = event_tx.send(AgentEvent::TextDelta { text }).await;
                    }
                    Ok(StreamEvent::ToolUseStart { id, name }) => {
                        // Flush any accumulated text
                        if !current_text.is_empty() {
                            assistant_content.push(ContentBlock::Text {
                                text: std::mem::take(&mut current_text),
                            });
                        }
                        current_tool_id = id.clone();
                        current_tool_name = name.clone();
                        current_tool_input.clear();
                        let _ = event_tx
                            .send(AgentEvent::ToolStart { id, name })
                            .await;
                    }
                    Ok(StreamEvent::ToolUseInputDelta(json)) => {
                        current_tool_input.push_str(&json);
                    }
                    Ok(StreamEvent::ToolUseEnd) => {
                        let input: serde_json::Value =
                            serde_json::from_str(&current_tool_input).unwrap_or_default();
                        assistant_content.push(ContentBlock::ToolUse {
                            id: current_tool_id.clone(),
                            name: current_tool_name.clone(),
                            input,
                        });
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

            // Save assistant message
            self.messages.push(Message {
                role: Role::Assistant,
                content: assistant_content.clone(),
            });

            // If stop reason is tool_use, execute tools and loop
            if stop_reason == StopReason::ToolUse {
                let mut tool_results: Vec<ContentBlock> = Vec::new();

                for block in &assistant_content {
                    if let ContentBlock::ToolUse { id, name, input } = block {
                        let output = self.execute_tool(name, input.clone()).await;
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
        }

        Ok(())
    }

    fn tool_definitions(&self) -> Vec<ToolDefinition> {
        self.tools
            .iter()
            .map(|t| ToolDefinition {
                name: t.name().to_string(),
                description: t.description().to_string(),
                input_schema: t.input_schema(),
            })
            .collect()
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
