use hank_provider::{CompletionRequest, LlmProvider, Message, StreamEvent};
use tokio_stream::StreamExt;
use tracing::{debug, warn};

/// Rough token estimation: chars / 4
pub fn estimate_tokens(messages: &[Message]) -> usize {
    messages
        .iter()
        .map(|m| {
            m.content
                .iter()
                .map(|block| match block {
                    hank_provider::ContentBlock::Text { text } => text.len(),
                    hank_provider::ContentBlock::Image { .. } => 0,
                    hank_provider::ContentBlock::ToolUse { input, .. } => {
                        input.to_string().len()
                    }
                    hank_provider::ContentBlock::ToolResult { content, .. } => content.len(),
                })
                .sum::<usize>()
        })
        .sum::<usize>()
        / 4
}

/// Generate a summary of messages for context compression.
/// This is a simple extractive summary — keeps key information.
pub fn summarize_messages(messages: &[Message]) -> String {
    let mut summary_parts = Vec::new();

    for msg in messages {
        let role = match msg.role {
            hank_provider::Role::User => "User",
            hank_provider::Role::Assistant => "Assistant",
        };

        for block in &msg.content {
            match block {
                hank_provider::ContentBlock::Text { text } => {
                    // Take first 200 chars of each text block
                    let truncated = if text.len() > 200 {
                        format!("{}...", &text[..200])
                    } else {
                        text.clone()
                    };
                    summary_parts.push(format!("[{role}]: {truncated}"));
                }
                hank_provider::ContentBlock::Image { .. } => {
                    summary_parts.push(format!("[{role} sent an image]"));
                }
                hank_provider::ContentBlock::ToolUse { name, .. } => {
                    summary_parts.push(format!("[{role} used tool: {name}]"));
                }
                hank_provider::ContentBlock::ToolResult { content, is_error, .. } => {
                    let status = if *is_error { "error" } else { "ok" };
                    let truncated = if content.len() > 100 {
                        format!("{}...", &content[..100])
                    } else {
                        content.clone()
                    };
                    summary_parts.push(format!("[Tool result ({status})]: {truncated}"));
                }
            }
        }
    }

    summary_parts.join("\n")
}

/// Summarize messages using an LLM for higher-quality context compression.
/// Falls back to extractive `summarize_messages()` on failure.
pub async fn summarize_with_llm(
    messages: &[Message],
    provider: &dyn LlmProvider,
    model: &str,
) -> String {
    // Build extractive summary as input material (avoids sending raw messages which could be huge)
    let extractive = summarize_messages(messages);

    let prompt = format!(
        "You are a context compression assistant. Below is an extractive summary of a conversation \
         between a user and an AI assistant. Produce a concise but complete summary that preserves:\n\
         - The original user request/goal\n\
         - Key decisions made\n\
         - Files modified or created\n\
         - Current progress and state\n\
         - What remains to be done\n\n\
         Keep the summary under 1000 words. Be factual and specific.\n\n\
         --- EXTRACTIVE SUMMARY ---\n{extractive}\n--- END ---\n\n\
         Produce your compressed summary now:"
    );

    let req = CompletionRequest {
        model: model.to_string(),
        system: None,
        messages: vec![Message {
            role: hank_provider::Role::User,
            content: vec![hank_provider::ContentBlock::Text { text: prompt }],
        }],
        tools: vec![],
        max_tokens: 2048,
    };

    match provider.stream(req).await {
        Ok(mut stream) => {
            let mut result = String::new();
            while let Some(event) = stream.next().await {
                match event {
                    Ok(StreamEvent::TextDelta(text)) => {
                        result.push_str(&text);
                    }
                    Ok(StreamEvent::MessageEnd { .. }) => break,
                    Err(e) => {
                        warn!("LLM summarization stream error: {e}, falling back to extractive");
                        return extractive;
                    }
                    _ => {}
                }
            }
            if result.is_empty() {
                warn!("LLM summarization returned empty, falling back to extractive");
                return extractive;
            }
            debug!("LLM summarization produced {} chars", result.len());
            result
        }
        Err(e) => {
            warn!("LLM summarization request failed: {e}, falling back to extractive");
            extractive
        }
    }
}
