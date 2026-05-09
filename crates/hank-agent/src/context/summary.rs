use hank_provider::Message;

/// Rough token estimation: chars / 4
pub fn estimate_tokens(messages: &[Message]) -> usize {
    messages
        .iter()
        .map(|m| {
            m.content
                .iter()
                .map(|block| match block {
                    hank_provider::ContentBlock::Text { text } => text.len(),
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
