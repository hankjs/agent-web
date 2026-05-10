use super::summary::{estimate_tokens, summarize_messages, summarize_with_llm};
use hank_provider::{ContentBlock, LlmProvider, Message, Role};
use std::sync::Arc;
use tracing::debug;

/// Default token threshold before compression triggers
const DEFAULT_TOKEN_THRESHOLD: usize = 80_000;
/// Number of recent messages to preserve during compression
const PRESERVE_RECENT: usize = 6;

/// Manages context window by estimating tokens and compressing when needed.
pub struct ContextManager {
    token_threshold: usize,
    provider: Option<Arc<dyn LlmProvider>>,
    model: Option<String>,
}

impl ContextManager {
    pub fn new() -> Self {
        Self {
            token_threshold: DEFAULT_TOKEN_THRESHOLD,
            provider: None,
            model: None,
        }
    }

    pub fn with_threshold(threshold: usize) -> Self {
        Self {
            token_threshold: threshold,
            provider: None,
            model: None,
        }
    }

    /// Create a ContextManager with LLM-based compression support.
    pub fn with_provider(
        threshold: usize,
        provider: Arc<dyn LlmProvider>,
        model: String,
    ) -> Self {
        Self {
            token_threshold: threshold,
            provider: Some(provider),
            model: Some(model),
        }
    }

    /// Check if messages exceed the token threshold.
    pub fn needs_compression(&self, messages: &[Message]) -> bool {
        estimate_tokens(messages) > self.token_threshold
    }

    /// Compress messages: keep first message + recent N messages,
    /// replace middle with a summary message.
    pub fn compress(&self, messages: &mut Vec<Message>) {
        if messages.len() <= PRESERVE_RECENT + 1 {
            return; // Not enough messages to compress
        }

        let estimated = estimate_tokens(messages);
        debug!(
            "Context compression triggered: ~{estimated} tokens, {} messages",
            messages.len()
        );

        // Keep first message (original request) and last N messages
        let first = messages[0].clone();
        let middle = &messages[1..messages.len() - PRESERVE_RECENT];
        let summary_text = summarize_messages(middle);

        let summary_msg = Message {
            role: Role::User,
            content: vec![ContentBlock::Text {
                text: format!(
                    "[Context Summary - previous {} messages compressed]\n{}",
                    middle.len(),
                    summary_text
                ),
            }],
        };

        let recent: Vec<Message> =
            messages[messages.len() - PRESERVE_RECENT..].to_vec();

        messages.clear();
        messages.push(first);
        messages.push(summary_msg);
        messages.extend(recent);

        debug!(
            "After compression: {} messages, ~{} tokens",
            messages.len(),
            estimate_tokens(messages)
        );
    }

    /// Async compression using LLM summarization with extractive fallback.
    pub async fn compress_async(&self, messages: &mut Vec<Message>) {
        if messages.len() <= PRESERVE_RECENT + 1 {
            return;
        }

        let estimated = estimate_tokens(messages);
        debug!(
            "Context compression (async) triggered: ~{estimated} tokens, {} messages",
            messages.len()
        );

        let first = messages[0].clone();
        let middle = &messages[1..messages.len() - PRESERVE_RECENT];

        let summary_text = if let (Some(provider), Some(model)) = (&self.provider, &self.model) {
            summarize_with_llm(middle, provider.as_ref(), model).await
        } else {
            summarize_messages(middle)
        };

        let summary_msg = Message {
            role: Role::User,
            content: vec![ContentBlock::Text {
                text: format!(
                    "[Context Summary - previous {} messages compressed]\n{}",
                    middle.len(),
                    summary_text
                ),
            }],
        };

        let recent: Vec<Message> =
            messages[messages.len() - PRESERVE_RECENT..].to_vec();

        messages.clear();
        messages.push(first);
        messages.push(summary_msg);
        messages.extend(recent);

        debug!(
            "After async compression: {} messages, ~{} tokens",
            messages.len(),
            estimate_tokens(messages)
        );
    }
}

impl Default for ContextManager {
    fn default() -> Self {
        Self::new()
    }
}
