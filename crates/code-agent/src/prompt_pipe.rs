/// Represents a segment of a system prompt that can be static or dynamically generated
pub enum PromptSegment {
    /// Static text that doesn't change
    Static(&'static str),
    /// Dynamically generated text
    Dynamic(String),
    /// Conditional segment — only included if condition is true
    Conditional { content: String, condition: bool },
}

/// Build a system prompt from multiple segments joined with double newlines
pub fn build_system_prompt(segments: &[PromptSegment]) -> String {
    segments
        .iter()
        .filter_map(|seg| match seg {
            PromptSegment::Static(s) => Some(s.to_string()),
            PromptSegment::Dynamic(s) => Some(s.clone()),
            PromptSegment::Conditional { content, condition } => {
                if *condition { Some(content.clone()) } else { None }
            }
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// 扫描项目目录，发现并加载上下文文件
pub async fn discover_project_context(work_dir: &str) -> Vec<PromptSegment> {
    let mut segments = Vec::new();
    let context_files = [
        ("CLAUDE.md", "Project Instructions (CLAUDE.md)"),
        ("AGENTS.md", "Agent Instructions (AGENTS.md)"),
        (".cursorrules", "Project Rules (.cursorrules)"),
    ];

    let max_chars: usize = 4000;

    for (filename, label) in &context_files {
        let path = format!("{}/{}", work_dir.trim_end_matches('/'), filename);
        if let Ok(content) = tokio::fs::read_to_string(&path).await {
            let truncated = if content.len() > max_chars {
                format!("{}...\n[truncated at {} chars]", &content[..max_chars], max_chars)
            } else {
                content
            };
            segments.push(PromptSegment::Dynamic(format!(
                "# {label}\n\n{truncated}"
            )));
        }
    }

    segments
}

/// Pre-built prompt segments for common scenarios
pub mod segments {
    /// Generate a budget warning segment
    pub fn budget_warning(percent: u8) -> String {
        format!(
            "⚠️ Context window usage at {}%. Be concise with responses.",
            percent
        )
    }

    /// Generate a loop warning segment
    pub fn loop_warning(tool_name: &str, count: usize) -> String {
        format!(
            "⚠️ Loop detected: tool '{}' called {} times in succession. Vary your approach or use different tools.",
            tool_name, count
        )
    }

    /// Static hint about think mode
    pub fn think_mode_hint() -> &'static str {
        "You are in THINK mode. Analyze the situation and plan your next steps. \
         Do NOT use tools. Just reason about what to do next."
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_prompt_mixed() {
        let segments = [
            PromptSegment::Static("Base instructions"),
            PromptSegment::Dynamic("Dynamic context".to_string()),
            PromptSegment::Static("Final guidelines"),
        ];

        let prompt = build_system_prompt(&segments);
        assert!(prompt.contains("Base instructions"));
        assert!(prompt.contains("Dynamic context"));
        assert!(prompt.contains("Final guidelines"));
        assert!(prompt.contains("\n\n"));
    }

    #[test]
    fn test_budget_warning_segment() {
        let warning = segments::budget_warning(85);
        assert!(warning.contains("85"));
        assert!(warning.contains("Context window"));
    }

    #[test]
    fn test_loop_warning_segment() {
        let warning = segments::loop_warning("shell", 4);
        assert!(warning.contains("shell"));
        assert!(warning.contains("4"));
    }
}
