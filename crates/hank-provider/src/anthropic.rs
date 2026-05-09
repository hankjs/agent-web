use crate::{CompletionRequest, LlmProvider, StopReason, StreamEvent};
use anyhow::{bail, Result};
use async_trait::async_trait;
use futures::Stream;
use reqwest::Client;
use std::pin::Pin;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tracing::debug;

const DEFAULT_BASE_URL: &str = "https://api.anthropic.com";

pub struct AnthropicProvider {
    client: Client,
    api_key: String,
    base_url: String,
}

impl AnthropicProvider {
    pub fn new(api_key: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
            base_url: DEFAULT_BASE_URL.to_string(),
        }
    }

    pub fn with_base_url(mut self, base_url: String) -> Self {
        self.base_url = base_url.trim_end_matches('/').to_string();
        self
    }
}

#[async_trait]
impl LlmProvider for AnthropicProvider {
    fn name(&self) -> &str {
        "anthropic"
    }

    async fn stream(
        &self,
        req: CompletionRequest,
    ) -> Result<Pin<Box<dyn Stream<Item = Result<StreamEvent>> + Send>>> {
        let url = format!("{}/v1/messages", self.base_url);
        let body = build_request_body(&req);
        debug!("Sending request to Anthropic API: {url}, model={}", req.model);

        let response = self
            .client
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            bail!("Anthropic API error {status}: {text}");
        }

        let (tx, rx) = mpsc::channel(64);
        let byte_stream = response.bytes_stream();

        tokio::spawn(async move {
            if let Err(e) = process_sse_stream(byte_stream, &tx).await {
                let _ = tx.send(Err(e)).await;
            }
        });

        Ok(Box::pin(ReceiverStream::new(rx)))
    }
}

fn build_request_body(req: &CompletionRequest) -> serde_json::Value {
    use crate::ContentBlock;

    let mut messages: Vec<serde_json::Value> = Vec::new();
    for msg in &req.messages {
        let content: Vec<serde_json::Value> = msg
            .content
            .iter()
            .map(|block| match block {
                ContentBlock::ToolResult { tool_use_id, content, is_error } => {
                    let mut result = serde_json::json!({
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": [{"type": "text", "text": content}],
                    });
                    if *is_error {
                        result["is_error"] = serde_json::json!(true);
                    }
                    result
                }
                _ => serde_json::to_value(block).unwrap(),
            })
            .collect();
        messages.push(serde_json::json!({
            "role": msg.role,
            "content": content,
        }));
    }

    let mut body = serde_json::json!({
        "model": req.model,
        "max_tokens": req.max_tokens,
        "messages": messages,
        "stream": true,
    });

    if let Some(system) = &req.system {
        body["system"] = serde_json::json!(system);
    }

    if !req.tools.is_empty() {
        let tools: Vec<serde_json::Value> = req
            .tools
            .iter()
            .map(|t| {
                serde_json::json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.input_schema,
                })
            })
            .collect();
        body["tools"] = serde_json::json!(tools);
    }

    body
}

async fn process_sse_stream(
    mut stream: impl futures::Stream<Item = Result<bytes::Bytes, reqwest::Error>> + Unpin,
    tx: &mpsc::Sender<Result<StreamEvent>>,
) -> Result<()> {
    use futures::StreamExt;

    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find("\n\n") {
            let event_str = buffer[..pos].to_string();
            buffer.drain(..pos + 2);

            if let Some(event) = parse_sse_event(&event_str) {
                debug!("Parsed StreamEvent: {event:?}");
                if tx.send(Ok(event)).await.is_err() {
                    return Ok(());
                }
            }
        }
    }

    Ok(())
}

fn parse_sse_event(raw: &str) -> Option<StreamEvent> {
    let mut event_type = String::new();
    let mut data = String::new();

    for line in raw.lines() {
        if let Some(val) = line.strip_prefix("event: ") {
            event_type = val.to_string();
        } else if let Some(val) = line.strip_prefix("data: ") {
            data = val.to_string();
        }
    }

    if data.is_empty() {
        return None;
    }

    let parsed: serde_json::Value = serde_json::from_str(&data).ok()?;

    match event_type.as_str() {
        "content_block_start" => {
            let block = parsed.get("content_block")?;
            let block_type = block.get("type")?.as_str()?;
            if block_type == "tool_use" {
                let id = block.get("id")?.as_str()?.to_string();
                let name = block.get("name")?.as_str()?.to_string();
                Some(StreamEvent::ToolUseStart { id, name })
            } else {
                None
            }
        }
        "content_block_delta" => {
            let delta = parsed.get("delta")?;
            let delta_type = delta.get("type")?.as_str()?;
            match delta_type {
                "text_delta" => {
                    let text = delta.get("text")?.as_str()?.to_string();
                    Some(StreamEvent::TextDelta(text))
                }
                "input_json_delta" => {
                    let json = delta.get("partial_json")?.as_str()?.to_string();
                    Some(StreamEvent::ToolUseInputDelta(json))
                }
                _ => None,
            }
        }
        "content_block_stop" => {
            // Only emit ToolUseEnd — the session layer uses in_tool_block tracking
            // to filter spurious events from text block stops
            Some(StreamEvent::ToolUseEnd)
        }
        "message_delta" => {
            let delta = parsed.get("delta")?;
            let stop_reason = delta.get("stop_reason")?.as_str()?;
            let reason = match stop_reason {
                "end_turn" => StopReason::EndTurn,
                "tool_use" => StopReason::ToolUse,
                "max_tokens" => StopReason::MaxTokens,
                _ => StopReason::EndTurn,
            };
            Some(StreamEvent::MessageEnd { stop_reason: reason })
        }
        "error" => {
            let msg = parsed
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown error")
                .to_string();
            Some(StreamEvent::Error(msg))
        }
        _ => None,
    }
}
