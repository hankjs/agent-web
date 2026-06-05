use crate::agent::orchestrator::OrchestratorAgent;
use crate::agent::verifier::VerifierAgent;
use crate::agent::{LoopDetector, ThinkStrategy, Verdict};
use crate::context::summary::{estimate_tokens, truncate_tool_result_default};
use crate::context::ContextManager;
use crate::retry::stream_with_retry;
use crate::types::{FileChange, FileChangeKind, RunStatus};
use crate::AgentEvent;
use anyhow::Result;
use hank_provider::{
    CompletionRequest, ContentBlock, LlmProvider, Message, Role, StopReason, StreamEvent,
    ToolDefinition,
};
use code_tools::{
    PermissionConfig, PermissionDecision, PermissionGuard, PermissionMode, Tool, ToolOutput,
    ToolRisk,
};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio_stream::StreamExt;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, warn};

const MAX_ITERATIONS: usize = 25;
const LLM_STREAM_TIMEOUT_SECS: u64 = 120;
const TOOL_TIMEOUT_SECS: u64 = 30;
/// 验证后最多允许修订的轮数（FR-VERIFY-2）
const MAX_REVISIONS: usize = 2;

/// 当前 UTC 时间戳（RFC3339）
fn now_ts() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// 权限门控结果
enum ToolGate {
    /// 允许执行
    Proceed,
    /// 被拒绝，附带原因（写入 tool_result，loop 继续）
    Denied(String),
}

/// 一次 run 内累积的执行状态（FR-LOOP-7, FR-PERM-6, FR-EVT-2）
#[derive(Default)]
struct RunState {
    run_id: String,
    permission_denials: Vec<String>,
    file_changes: Vec<FileChange>,
    input_tokens: u32,
    output_tokens: u32,
}

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
    /// 权限守卫（默认 workspace-write）
    permission: Arc<PermissionGuard>,
    /// 工作目录，用于 sandbox 路径校验与环境上下文
    work_dir: String,
    /// 分层上下文 debug 摘要：(segment 名称列表, 总字符数)。
    /// 设置后会在 run 开始时发出 ContextAssembled 事件（FR-CTX-9, FR-EVT-9）。
    context_summary: Option<(Vec<String>, usize)>,
    /// 写操作后是否启用 VerifierAgent 复核（FR-VERIFY-1/2）
    verify_after_write: bool,
    /// 原始用户请求（验证时用于传入 VerifierAgent）
    original_request: String,
    /// FR-TOOL-7: 延迟加载的工具名集合 — 初始只注册 stub，首次调用时注入完整 schema
    deferred_tool_names: std::collections::HashSet<String>,
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
            permission: Arc::new(PermissionGuard::with_defaults()),
            work_dir: String::new(),
            context_summary: None,
            verify_after_write: false,
            original_request: String::new(),
            deferred_tool_names: std::collections::HashSet::new(),
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
            permission: Arc::new(PermissionGuard::with_defaults()),
            work_dir: String::new(),
            context_summary: None,
            verify_after_write: false,
            original_request: String::new(),
            deferred_tool_names: std::collections::HashSet::new(),
        }
    }

    /// 设置权限模式与工作目录（FR-PERM-1/4）。
    /// work_dir 既用于 sandbox 路径前缀校验，也作为默认可写根。
    pub fn with_permission(mut self, mode: PermissionMode, work_dir: impl Into<String>) -> Self {
        let work_dir = work_dir.into();
        let mut config = PermissionConfig::default();
        config.mode = mode;
        if !work_dir.is_empty() {
            config.sandbox_paths = vec![work_dir.clone()];
        }
        self.permission = Arc::new(PermissionGuard::new(config));
        self.work_dir = work_dir;
        self
    }

    /// 使用自定义权限配置
    pub fn with_permission_config(mut self, config: PermissionConfig, work_dir: impl Into<String>) -> Self {
        self.permission = Arc::new(PermissionGuard::new(config));
        self.work_dir = work_dir.into();
        self
    }

    /// 启用写操作后 VerifierAgent 复核（FR-VERIFY-1/2）。
    pub fn with_verification(mut self) -> Self {
        self.verify_after_write = true;
        self
    }

    /// FR-TOOL-7: 将指定工具标记为延迟加载。
    /// 初始 tool_definitions 中只有 stub（name+description，无详细 schema），
    /// 首次被 LLM 调用时动态注入完整 schema。
    pub fn with_deferred_tools(mut self, names: impl IntoIterator<Item = impl Into<String>>) -> Self {
        let deferred: std::collections::HashSet<String> = names.into_iter().map(|n| n.into()).collect();
        // 替换 deferred 工具的 tool_definition 为 stub（空 schema）
        for def in &mut self.tool_definitions {
            if deferred.contains(&def.name) {
                def.input_schema = serde_json::json!({ "type": "object", "properties": {}, "required": [] });
            }
        }
        self.deferred_tool_names = deferred;
        self
    }

    /// 按分层组装系统提示词并记录 debug 摘要（FR-CTX-1/9）。
    /// 传入已组装好的分层（base/developer/environment/project），
    /// 由 prompt_pipe::build_layered_prompt 产出。
    pub fn with_layered_prompt(mut self, named_segments: Vec<crate::prompt_pipe::NamedSegment>) -> Self {
        let assembled = named_segments
            .iter()
            .map(|s| s.content.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");
        let names: Vec<String> = named_segments.iter().map(|s| s.name.to_string()).collect();
        let total_chars = assembled.chars().count();
        self.system_prompt = assembled;
        self.context_summary = Some((names, total_chars));
        self
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
        let run_id = uuid::Uuid::new_v4().to_string();

        // FR-EVT-2: run.started
        let _ = event_tx
            .send(AgentEvent::RunStarted {
                run_id: run_id.clone(),
                timestamp: now_ts(),
                cwd: if self.work_dir.is_empty() { None } else { Some(self.work_dir.clone()) },
                model: self.model.clone(),
                permission_mode: self.permission.mode().as_str().to_string(),
                tools: self.tool_definitions.iter().map(|t| t.name.clone()).collect(),
            })
            .await;

        // FR-CTX-9 / FR-EVT-9: context.assembled（仅 debug 摘要，不含完整 system prompt）
        if let Some((ref segments, total_chars)) = self.context_summary {
            let _ = event_tx
                .send(AgentEvent::ContextAssembled {
                    run_id: run_id.clone(),
                    turn_id: String::new(),
                    segments: segments.clone(),
                    total_chars,
                })
                .await;
        }

        // 记录原始请求用于验证阶段（FR-VERIFY-1）
        if self.original_request.is_empty() {
            self.original_request = user_content
                .iter()
                .filter_map(|b| if let ContentBlock::Text { text } = b { Some(text.as_str()) } else { None })
                .collect::<Vec<_>>()
                .join(" ");
        }

        match &self.mode {
            AgentMode::Simple => {
                let mut run_state = RunState {
                    run_id: run_id.clone(),
                    ..Default::default()
                };
                let result = self
                    .run_simple(user_content, event_tx.clone(), cancel.clone(), &mut run_state)
                    .await;
                let paused = matches!(result, Ok(true));
                let plain: Result<()> = result.map(|_| ());
                self.emit_run_terminal(&run_id, &run_state, &plain, paused, &cancel, &event_tx).await;
                // 终态后统一发出 TurnComplete 关闭 SSE 流（在 RunCompleted 之后）
                let _ = event_tx.send(AgentEvent::TurnComplete).await;
                plain
            }
            AgentMode::Orchestrated { think_strategy } => {
                let think_strategy = think_strategy.clone();
                let result = self
                    .run_orchestrated(user_content, event_tx.clone(), cancel.clone(), think_strategy)
                    .await;
                // Orchestrator 维护自身循环与 TurnComplete；这里只补 run 终态
                let run_state = RunState { run_id: run_id.clone(), ..Default::default() };
                self.emit_run_terminal(&run_id, &run_state, &result, false, &cancel, &event_tx).await;
                result
            }
        }
    }

    /// 发出 run 终态事件（completed/failed/cancelled）。
    /// paused=true 表示因 ask_user 暂停，不发 RunCompleted。
    async fn emit_run_terminal(
        &self,
        run_id: &str,
        run_state: &RunState,
        result: &Result<()>,
        paused: bool,
        cancel: &CancellationToken,
        event_tx: &mpsc::Sender<AgentEvent>,
    ) {
        match result {
            Err(e) => {
                let _ = event_tx
                    .send(AgentEvent::RunFailed {
                        run_id: run_id.to_string(),
                        timestamp: now_ts(),
                        message: format!("{e:#}"),
                    })
                    .await;
            }
            Ok(()) if paused => {
                // ask_user 暂停：run 未结束，不发终态事件
            }
            Ok(()) if cancel.is_cancelled() => {
                // FR-SESSION-5: 取消后保留 partial file_changes/permission_denials
                let _ = event_tx
                    .send(AgentEvent::RunCancelled {
                        run_id: run_id.to_string(),
                        timestamp: now_ts(),
                        file_changes: run_state.file_changes.clone(),
                        permission_denials: run_state.permission_denials.clone(),
                    })
                    .await;
            }
            Ok(()) => {
                let summary = self.build_run_summary(run_state);
                let _ = event_tx
                    .send(AgentEvent::RunCompleted {
                        run_id: run_id.to_string(),
                        timestamp: now_ts(),
                        status: RunStatus::Success,
                        input_tokens: run_state.input_tokens,
                        output_tokens: run_state.output_tokens,
                        summary,
                        permission_denials: run_state.permission_denials.clone(),
                        file_changes: run_state.file_changes.clone(),
                    })
                    .await;
            }
        }
    }

    /// 构造标准化最终汇报：改动文件 + 权限拒绝（FR-LOOP-4 验收 / 第8节）
    fn build_run_summary(&self, run_state: &RunState) -> String {
        let mut parts: Vec<String> = Vec::new();
        if run_state.file_changes.is_empty() {
            parts.push("No file changes.".to_string());
        } else {
            let files: Vec<String> = run_state
                .file_changes
                .iter()
                .map(|c| format!("{:?} {}", c.kind, c.path))
                .collect();
            parts.push(format!("Changed files: {}", files.join(", ")));
        }
        if !run_state.permission_denials.is_empty() {
            parts.push(format!(
                "Permission denials: {}",
                run_state.permission_denials.join("; ")
            ));
        }
        parts.join(" | ")
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

    /// 验证阶段：写操作后调用 VerifierAgent，发 VerificationStarted/VerificationCompleted。
    /// 返回 issues（空=Approved/parse失败），needs_revision=true 时调用方可回注修订。
    async fn run_verify_phase(
        &self,
        run_id: &str,
        event_tx: &mpsc::Sender<AgentEvent>,
        cancel: CancellationToken,
        summary: &str,
    ) -> (Verdict, Vec<String>) {
        // 过滤出只读工具（FR-VERIFY-1）
        let readonly_tools: Vec<Arc<dyn Tool>> = self
            .tools
            .iter()
            .filter(|t| t.risk_level() == ToolRisk::Safe)
            .cloned()
            .collect();

        let _ = event_tx
            .send(AgentEvent::VerificationStarted { run_id: run_id.to_string(), command: None })
            .await;

        let verifier = VerifierAgent::new(self.provider.clone(), readonly_tools, self.model.clone());
        let result = verifier
            .verify(&self.original_request, summary, event_tx.clone(), cancel)
            .await
            .unwrap_or_else(|e| {
                warn!("VerifierAgent error: {e}");
                crate::agent::VerificationResult {
                    verdict: Verdict::Approved,
                    issues: vec![format!("Verification failed: {e}")],
                }
            });

        let _ = event_tx
            .send(AgentEvent::VerificationCompleted {
                run_id: run_id.to_string(),
                verdict: result.verdict.clone(),
                issues: result.issues.clone(),
            })
            .await;

        (result.verdict, result.issues)
    }

    /// Simple mode: flat stream → tools → loop (original behavior).
    /// 返回 Ok(true) 表示因 ask_user 暂停，Ok(false) 表示正常结束。
    /// 终态 TurnComplete 由 run() 在 RunCompleted 之后统一发出。
    async fn run_simple(
        &mut self,
        user_content: Vec<ContentBlock>,
        event_tx: mpsc::Sender<AgentEvent>,
        cancel: CancellationToken,
        run_state: &mut RunState,
    ) -> Result<bool> {
        self.messages.push(Message {
            role: Role::User,
            content: user_content,
        });
        let mut revision_count = 0usize;

        let mut consecutive_max_tokens = 0u32;
        let mut loop_detector = LoopDetector::new();
        let run_id = run_state.run_id.clone();

        for iteration in 0..MAX_ITERATIONS {
            if cancel.is_cancelled() {
                break;
            }

            // FR-LOOP-7 / FR-EVT-3: turn.started
            let turn_id = uuid::Uuid::new_v4().to_string();
            let _ = event_tx
                .send(AgentEvent::TurnStarted {
                    run_id: run_id.clone(),
                    turn_id: turn_id.clone(),
                    timestamp: now_ts(),
                    phase: "simple".to_string(),
                    message_count: self.messages.len(),
                })
                .await;

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

            // 累积到 run 级别 usage（FR-EVT-2: run.completed.usage）
            run_state.input_tokens = run_state.input_tokens.max(total_input_tokens);
            run_state.output_tokens += total_output_tokens;

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
                        // FR-BUDGET-6: 压缩后重置 actual tokens 避免旧值误判
                        self.context_manager.reset_actual_tokens();
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
                break;
            }

            // Handle MaxTokens: continue generation instead of stopping
            if stop_reason == StopReason::MaxTokens {
                warn!("MaxTokens hit at iteration {iteration}, continuing generation");
                consecutive_max_tokens += 1;
                if consecutive_max_tokens >= 3 {
                    warn!("3 consecutive MaxTokens without tool use, treating as done");
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
                            return Ok(false);
                        }

                        // FR-TOOL-7: 首次调用 deferred 工具时注入完整 schema
                        if self.deferred_tool_names.contains(name) {
                            if let Some(tool) = self.tools.iter().find(|t| t.name() == name) {
                                if let Some(def) = self.tool_definitions.iter_mut().find(|d| d.name == *name) {
                                    def.input_schema = tool.input_schema();
                                }
                            }
                            self.deferred_tool_names.remove(name);
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
                        if loop_detector.record_and_check(name, input) {
                            let pattern = loop_detector.loop_pattern();
                            let _ = event_tx
                                .send(AgentEvent::LoopDetected {
                                    pattern: pattern.clone(),
                                    window_size: 6,
                                })
                                .await;

                            if loop_detector.should_terminate(3) {
                                warn!("Loop detected: terminating agent loop");
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

                        // ─── 权限检查 (FR-PERM-2/4/5/6) ───
                        match self.gate_tool(name, input, id, &run_id, &turn_id, &event_tx, run_state).await {
                            ToolGate::Proceed => {}
                            ToolGate::Denied(reason) => {
                                tool_results.push(ContentBlock::ToolResult {
                                    tool_use_id: id.clone(),
                                    content: format!(
                                        "Permission denied: {reason}. This action was not executed. \
                                         If needed, the user can perform it manually."
                                    ),
                                    is_error: true,
                                });
                                continue;
                            }
                        }

                        // 写工具：记录执行前文件是否存在，用于区分 add/update
                        let pre_exists = if name == "write_file" || name == "str_replace" {
                            input["path"].as_str().map(|p| {
                                std::path::Path::new(&self.resolve_path(p)).exists()
                            })
                        } else {
                            None
                        };

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
                            self.execute_tool(name, input.clone(), &event_tx, id),
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

                        // ─── 文件变更事件 (FR-TOOL-6, FR-EVT-4) ───
                        if !output.is_error {
                            if let Some(change) = self.detect_file_change(name, input, pre_exists) {
                                run_state.file_changes.push(change.clone());
                                let _ = event_tx
                                    .send(AgentEvent::FileChanged {
                                        run_id: run_id.clone(),
                                        turn_id: turn_id.clone(),
                                        changes: vec![change],
                                    })
                                    .await;
                            }
                        }

                        let content = truncate_tool_result_default(&output.content);
                        // FR-ROBUST-4/5: 工具失败后结构化分类，附加语义提示辅助模型恢复
                        let content = if output.is_error {
                            classify_tool_error(&content, name)
                        } else {
                            content
                        };
                        tool_results.push(ContentBlock::ToolResult {
                            tool_use_id: id.clone(),
                            content,
                            is_error: output.is_error,
                        });
                    }
                }

                // If ask_user was triggered, break the agent loop (don't push tool results).
                // 返回 paused，由 run() 发出终态 TurnComplete 关闭 SSE 流。
                if ask_user_triggered {
                    return Ok(true);
                }

                self.messages.push(Message {
                    role: Role::User,
                    content: tool_results,
                });

                // Budget check after tool results to catch large tool outputs
                match self.context_manager.check_budget(&self.messages) {
                    crate::context::BudgetStatus::Overflow100 => {
                        warn!("Budget overflow after tool results, terminating");
                        let _ = event_tx
                            .send(AgentEvent::TurnCompleted {
                                run_id: run_id.clone(),
                                turn_id: turn_id.clone(),
                                timestamp: now_ts(),
                            })
                            .await;
                        break;
                    }
                    crate::context::BudgetStatus::Critical95 => {
                        let used = estimate_tokens(&self.messages);
                        if let Some(strategy) = self.context_manager.compress_async(&mut self.messages).await {
                            let after = estimate_tokens(&self.messages);
                            // FR-BUDGET-6: 压缩后重置 actual tokens
                            self.context_manager.reset_actual_tokens();
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

                // FR-EVT-3: turn.completed（工具轮结束，loop 将继续下一轮 LLM 交互）
                let _ = event_tx
                    .send(AgentEvent::TurnCompleted {
                        run_id: run_id.clone(),
                        turn_id: turn_id.clone(),
                        timestamp: now_ts(),
                    })
                    .await;
            } else {
                // Turn complete（正常结束，终态 TurnComplete 由 run() 发出）
                let _ = event_tx
                    .send(AgentEvent::TurnCompleted {
                        run_id: run_id.clone(),
                        turn_id: turn_id.clone(),
                        timestamp: now_ts(),
                    })
                    .await;

                // ─── 验证阶段 (FR-VERIFY-1/2) ───
                // 有写操作、验证已启用、未达修订上限、未取消时触发
                if self.verify_after_write
                    && !run_state.file_changes.is_empty()
                    && revision_count < MAX_REVISIONS
                    && !cancel.is_cancelled()
                {
                    let summary = self.build_run_summary(run_state);
                    let (verdict, issues) = self
                        .run_verify_phase(&run_id, &event_tx, cancel.clone(), &summary)
                        .await;

                    match verdict {
                        Verdict::Approved => {
                            break;
                        }
                        Verdict::NeedsRevision => {
                            revision_count += 1;
                            // 将 issues 回注为新的 user turn，继续修订循环
                            let issues_text = issues.join("\n- ");
                            self.messages.push(Message {
                                role: Role::User,
                                content: vec![ContentBlock::Text {
                                    text: format!(
                                        "Verification found issues that need to be fixed:\n- {issues_text}\n\nPlease fix these issues."
                                    ),
                                }],
                            });
                            // 继续下一轮 iteration，不 break
                        }
                        Verdict::Rejected => {
                            // 终止循环，issues 将在 build_run_summary 中通过 file_changes 记录
                            // 在 run_state 中记录拒绝原因以便 summary 引用
                            for issue in &issues {
                                run_state.permission_denials.push(format!("verification rejected: {issue}"));
                            }
                            break;
                        }
                    }
                } else {
                    break;
                }
            }

            if iteration == MAX_ITERATIONS - 1 {
                warn!("Agent loop reached max iterations ({MAX_ITERATIONS})");
            }
        }

        Ok(false)
    }

    /// 解析相对路径为绝对路径（与工具内逻辑保持一致）
    fn resolve_path(&self, path: &str) -> String {
        if path.starts_with('/') || self.work_dir.is_empty() {
            path.to_string()
        } else {
            format!("{}/{}", self.work_dir.trim_end_matches('/'), path)
        }
    }

    /// 查询工具声明的风险等级
    fn tool_risk(&self, name: &str) -> ToolRisk {
        self.tools
            .iter()
            .find(|t| t.name() == name)
            .map(|t| t.risk_level())
            .unwrap_or(ToolRisk::Safe)
    }

    /// 根据工具类型与执行前状态推断文件变更（FR-TOOL-6）
    fn detect_file_change(
        &self,
        name: &str,
        input: &serde_json::Value,
        pre_exists: Option<bool>,
    ) -> Option<FileChange> {
        let path = input["path"].as_str()?.to_string();
        match name {
            "write_file" => {
                let kind = if pre_exists == Some(true) {
                    FileChangeKind::Update
                } else {
                    FileChangeKind::Add
                };
                Some(FileChange { path, kind })
            }
            "str_replace" => Some(FileChange { path, kind: FileChangeKind::Update }),
            _ => None,
        }
    }

    /// 工具执行前的权限门控（FR-PERM-2/5/6）。
    /// - Allow → Proceed
    /// - Deny → 发 permission.denied，记录 denial，返回 Denied
    /// - NeedApproval → 非交互场景优雅降级为 Denied，发 permission.requested + permission.denied
    async fn gate_tool(
        &self,
        name: &str,
        input: &serde_json::Value,
        tool_use_id: &str,
        run_id: &str,
        turn_id: &str,
        event_tx: &mpsc::Sender<AgentEvent>,
        run_state: &mut RunState,
    ) -> ToolGate {
        let risk = self.tool_risk(name);
        let decision = self.permission.check(name, input, risk, &self.work_dir);
        match decision {
            PermissionDecision::Allow => ToolGate::Proceed,
            PermissionDecision::Deny(reason) => {
                run_state.permission_denials.push(format!("{name}: {reason}"));
                let _ = event_tx
                    .send(AgentEvent::PermissionDenied {
                        run_id: run_id.to_string(),
                        turn_id: turn_id.to_string(),
                        tool: name.to_string(),
                        tool_use_id: tool_use_id.to_string(),
                        reason: reason.clone(),
                    })
                    .await;
                ToolGate::Denied(reason)
            }
            PermissionDecision::NeedApproval(reason) => {
                // 先广播审批请求（前端可据此展示）
                let _ = event_tx
                    .send(AgentEvent::PermissionRequested {
                        run_id: run_id.to_string(),
                        turn_id: turn_id.to_string(),
                        tool: name.to_string(),
                        tool_use_id: tool_use_id.to_string(),
                        risk: format!("{:?}", risk),
                        reason: reason.clone(),
                    })
                    .await;
                // 非交互场景优雅降级：拒绝执行但不阻塞（FR-PERM-5）
                let denial = format!("requires approval: {reason}");
                run_state.permission_denials.push(format!("{name}: {denial}"));
                let _ = event_tx
                    .send(AgentEvent::PermissionDenied {
                        run_id: run_id.to_string(),
                        turn_id: turn_id.to_string(),
                        tool: name.to_string(),
                        tool_use_id: tool_use_id.to_string(),
                        reason: denial.clone(),
                    })
                    .await;
                ToolGate::Denied(denial)
            }
        }
    }

    async fn execute_tool(&self, name: &str, input: serde_json::Value, event_tx: &mpsc::Sender<AgentEvent>, tool_use_id: &str) -> ToolOutput {        for tool in &self.tools {
            if tool.name() == name {
                if tool.supports_streaming() {
                    // Streaming execution: forward chunks as ToolOutputDelta events
                    let (stream_tx, mut stream_rx) = mpsc::channel::<String>(64);
                    let event_tx_clone = event_tx.clone();
                    let id_clone = tool_use_id.to_string();

                    let forward_handle = tokio::spawn(async move {
                        while let Some(chunk) = stream_rx.recv().await {
                            let _ = event_tx_clone.send(AgentEvent::ToolOutputDelta {
                                id: id_clone.clone(),
                                chunk,
                            }).await;
                        }
                    });

                    let result = match tool.execute_streaming(input, stream_tx).await {
                        Ok(output) => output,
                        Err(e) => ToolOutput {
                            content: format!("Tool execution error: {e}"),
                            is_error: true,
                        },
                    };

                    // Wait for forwarding to complete
                    let _ = forward_handle.await;
                    return result;
                } else {
                    return match tool.execute(input).await {
                        Ok(output) => output,
                        Err(e) => ToolOutput {
                            content: format!("Tool execution error: {e}"),
                            is_error: true,
                        },
                    };
                }
            }
        }
        ToolOutput {
            content: format!("Unknown tool: {name}"),
            is_error: true,
        }
    }
}

/// FR-ROBUST-4/5: 工具失败后错误分类，附加语义提示帮助模型选择恢复策略。
fn classify_tool_error(content: &str, tool_name: &str) -> String {
    let lower = content.to_lowercase();
    let category = if lower.contains("command not found") || lower.contains("no such file or directory") && tool_name == "shell" {
        "[error_type: command_not_found] The command is not installed. Try an alternative command or check if it needs to be installed first."
    } else if lower.contains("permission denied") || lower.contains("access denied") || lower.contains("operation not permitted") {
        "[error_type: permission_denied] Insufficient permissions. This action requires elevated privileges or is outside the allowed workspace."
    } else if lower.contains("network") || lower.contains("dns") || lower.contains("connection refused") || lower.contains("could not resolve") {
        "[error_type: network_failure] Network or DNS failure. The resource may be unreachable; try a local fallback if available."
    } else if lower.contains("not found") || lower.contains("does not exist") || lower.contains("no such file") {
        "[error_type: not_found] File or resource not found. Verify the path or create the missing resource first."
    } else if lower.contains("timed out") || lower.contains("timeout") {
        "[error_type: timeout] Operation timed out. Consider splitting the task or using a faster alternative."
    } else if lower.contains("test") && (lower.contains("failed") || lower.contains("error") || lower.contains("assert")) {
        "[error_type: test_failure] Tests failed. Read the failure output carefully and make targeted fixes."
    } else {
        "[error_type: tool_error]"
    };
    format!("{category}\n{content}")
}
