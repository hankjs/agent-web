import { ref } from "vue";
import { encodingForModel } from "js-tiktoken";
import { authFetch } from "../../composables/useSession";
import {
  createRequirementDoc,
  updateRequirementDoc,
  getRequirementDocByChange,
} from "../../api/admin";
import {
  buildExplorePlannerPrompt,
  buildExploreReaderSystem,
  buildExploreSummarizerPrompt,
} from "./prompts";
import { callLLM, callLLMWithTools, execTool } from "./llm";
import { READER_TOOLS } from "./tools";
import {
  BlockKind,
  type ExploreAgentState,
  type ExploreAgentOptions,
  type Finding,
  type PlannerAction,
  type LlmMessage,
  type Block,
  type DocumentSection,
} from "./types";
import {
  runDocUpdater,
  applySectionUpdates,
  assembleMarkdown,
  getDocProgress,
  parseTemplateToSections,
  parseMarkdownToSections,
  runTaskGenerator,
} from "./docUpdater";
import { useDocHistory } from "./useDocHistory";
import { ContextCache } from "./contextCache";
import { safeInput, parseFindings, trimMessages } from "./utils";

const enc = encodingForModel("gpt-4o"); // cl100k_base compatible

let summarizeThreshold = 800;

function estimateTokens(text: string): number {
  return enc.encode(text).length;
}

const HARD_MAX_READS = 20;
const MAX_CONSECUTIVE_ERRORS = 3;
const TOKEN_BUDGET_WARN = 12000; // 累计 token 接近此值时注入收敛信号

/** 根据 reader round 生成动态指令（渐进式催促） */
function getReaderRoundDirective(round: number, maxRounds: number): string {
  if (round >= maxRounds - 1) {
    return "\n\n⚠ 这是最后一轮，必须立即调用 report_findings 报告你目前了解到的所有信息。";
  }
  if (round >= maxRounds - 2) {
    return "\n\n提示：你已使用 " + (round + 1) + " 轮，请尽快调用 report_findings。";
  }
  return "";
}

export function useExploreAgent(options: ExploreAgentOptions) {
  const state = ref<ExploreAgentState>({
    phase: "idle",
    runningSummary: "",
    findings: [],
    turnCount: 0,
    filesRead: [],
    documentSections: [],
    documentName: "",
    templateId: null,
    requirementDocId: null,
  });

  const isFirstTurn = ref(true);
  const startTime = Date.now();
  let abortController = new AbortController();
  let consecutiveAsksTotal = 0; // 跨 reactLoop 调用追踪连续 ask_user 次数
  let totalTokensUsed = 0; // 累计 token 消耗（用于预算感知）
  const docHistory = useDocHistory();
  const contextCache = new ContextCache(); // Offload: 大工具结果缓存

  // Prompt Cache: reader system prompt 只含 workDir，整个会话生命周期不变
  // 确保 API 层 prefix cache 跨多次 executeReadCode 调用命中
  const readerSystemPrompt = buildExploreReaderSystem(options.workDir);

  function elapsed() { return Date.now() - startTime; }

  // Pause/resume mechanism for AskUserQuestion inside tool loop
  let answerResolver: ((answer: string) => void) | null = null;

  function waitForAnswer(): Promise<string> {
    return new Promise(resolve => { answerResolver = resolve; });
  }

  function resolveAnswer(answer: string) {
    if (answerResolver) { answerResolver(answer); answerResolver = null; }
  }

  function cancel() {
    abortController.abort();
    state.value.phase = "cancelled";
    options.onBlock({ kind: BlockKind.Text, content: "探索已取消。" });
    options.onStreaming(false);
    options.onComplete();
  }

  function getMaxReads(): number {
    const depth = options.metadata?.depth || "standard";
    switch (depth) {
      case "quick": return 4;
      case "standard": return 8;
      case "deep": return 15;
      default: return 8;
    }
  }

  async function logEvent(type: string, payload: any, visibility: "user" | "internal") {
    try {
      await authFetch(`/api/sessions/${options.sessionId}/local-events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ event_type: type, agent_type: "explore_react", payload, source: "client", visibility }]),
      });
    } catch { /* best effort */ }
  }

  /** 将文档变更 diff 记录到数据库，用于展示变更历史 */
  async function saveDocDiff(source: string, diffs: Array<{ sectionId: string; oldContent: string; newContent: string }>) {
    await logEvent("explore:doc_diff", {
      documentName: state.value.documentName,
      diffs,
      source,
    }, "internal");
  }

  // --- Planner Isolation ---
  // Planner 使用独立上下文（by communicating 模式）：
  // 只接收 runningSummary + docProgress + filesRead + userInput
  // 不接收 reader 的完整工具调用历史，大幅减少 planner 的 token 消耗

  async function runPlannerStep(userInput: string, images?: Array<{ media_type: string; data: string }>, extraContext?: { consecutiveReads?: number; tokenBudgetWarn?: boolean }): Promise<PlannerAction | null> {
    state.value.phase = "thinking";
    const prompt = buildExplorePlannerPrompt({
      summary: state.value.runningSummary || "（尚未开始探索）",
      userInput: (extraContext?.tokenBudgetWarn
        ? userInput + "\n（⚠ 上下文预算紧张，请尽快收敛或总结当前发现）"
        : userInput),
      turnCount: state.value.turnCount,
      maxTurns: HARD_MAX_READS,
      findingsCount: state.value.findings.length,
      elapsedSec: Math.round(elapsed() / 1000),
      filesRead: state.value.filesRead,
      docProgress: getDocProgress(state.value.documentSections),
      isFirstTurn: isFirstTurn.value,
      consecutiveReads: extraContext?.consecutiveReads ?? 0,
    });
    await logEvent("explore:thought", { prompt_preview: prompt.slice(0, 200), cache_stats: contextCache.stats }, "internal");
    // Emit a thinking block that will stream planner output
    const thinkingBlock: Extract<Block, { kind: BlockKind.Thinking }> = { kind: BlockKind.Thinking, content: "" };
    options.onBlock(thinkingBlock);

    const MAX_PLANNER_RETRIES = 2;
    let lastError = "";

    for (let attempt = 0; attempt <= MAX_PLANNER_RETRIES; attempt++) {
      try {
        const systemPrompt = attempt === 0
          ? "你是一个 JSON 输出机器，只返回合法 JSON。"
          : `你是一个 JSON 输出机器，只返回合法 JSON。\n\n上次输出失败原因: ${lastError}\n请严格只输出一个 JSON 对象，不要包含任何其他文字。`;
        thinkingBlock.content = "";
        const { text: response, meta, httpStatus } = await callLLM(systemPrompt, prompt, images, abortController.signal, (delta) => {
          thinkingBlock.content += delta;
          options.onBlock({ kind: BlockKind.Thinking, content: thinkingBlock.content });
        });
        await logEvent("explore:llm_call", { turn: state.value.turnCount, phase: "planner", attempt, tokens_in: meta.tokens_in, tokens_out: meta.tokens_out, latency_ms: meta.latency_ms, tools_count: 0, elapsed_ms: elapsed(), httpStatus, system: systemPrompt, messages: prompt }, "internal");

        if (!response || response.trim().length === 0) {
          lastError = "LLM 返回空响应";
          await logEvent("explore:planner_retry", { attempt, error: lastError, willRetry: attempt < MAX_PLANNER_RETRIES, httpStatus }, "user");
          if (attempt < MAX_PLANNER_RETRIES) continue;
          throw new Error(lastError);
        }

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          lastError = `响应中未找到 JSON (响应前100字: ${response.slice(0, 100)})`;
          await logEvent("explore:planner_retry", { attempt, error: lastError, willRetry: attempt < MAX_PLANNER_RETRIES, httpStatus }, "user");
          if (attempt < MAX_PLANNER_RETRIES) continue;
          throw new Error("No JSON in planner response");
        }

        const action: PlannerAction = JSON.parse(jsonMatch[0]);
        await logEvent("explore:action", action, "user");
        // Emit persistent PlannerDecision block (thinking will be cleared by clearThinkingIfNeeded)
        const actionLabel = action.action === "read_code" ? "阅读代码" : action.action === "ask_user" ? "向用户提问" : action.action === "confirm_requirement" ? "确认需求文档" : "完成探索";
        options.onBlock({ kind: BlockKind.PlannerDecision, reasoning: action.reasoning, action: actionLabel, objective: action.params?.objective, expanded: false });
        return action;
      } catch (e: any) {
        if (e.name === "AbortError") return null;
        lastError = e.message;
        const statusMatch = lastError.match(/LLM error: (\d+)/);
        const httpStatus = statusMatch ? parseInt(statusMatch[1]) : undefined;
        if (attempt < MAX_PLANNER_RETRIES) {
          await logEvent("explore:planner_retry", { attempt, error: lastError, willRetry: true, httpStatus }, "user");
          continue;
        }
        await logEvent("explore:error", { phase: "planner", error: lastError, attempts: attempt + 1, httpStatus }, "user");
        options.onBlock({ kind: BlockKind.Error, content: `规划失败: ${e.message}` });
        return null;
      }
    }
    return null;
  }

  async function executeReadCode(params: { objective: string; files_hint?: string[] }, reasoning?: string): Promise<Finding[]> {
    state.value.phase = "acting";
    const statusMsg = `正在阅读代码: ${params.objective}`;
    // Emit an explore_round block that groups all tool calls for this read
    options.onBlock({ kind: BlockKind.ExploreRound, objective: params.objective, reasoning, tools: [], expanded: false, isRunning: true } as any);
    await logEvent("explore:status", { message: statusMsg }, "user");

    // Prompt Cache 友好：system prompt 只含 workDir（会话级稳定），objective 放入 user message
    // 这样 API 层的 prefix cache 可以跨多次 executeReadCode 调用命中
    const system = readerSystemPrompt;
    const objectiveText = params.objective + (params.files_hint?.length ? `\n提示文件: ${params.files_hint.join(", ")}` : "");

    let messages: LlmMessage[] = [{ role: "user", content: [{ type: "text", text: `阅读目标：${objectiveText}\n\n开始阅读。` }] }];
    const MAX_TOOL_ROUNDS = 5;
    let earlyFindings: Finding[] | null = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // 渐进式指令注入：作为独立 user message 追加，不修改已有消息内容（保护 prefix cache）
      const roundDirective = getReaderRoundDirective(round, MAX_TOOL_ROUNDS);
      const trimmed = trimMessages(messages);
      const messagesForCall = roundDirective
        ? [...trimmed, { role: "user" as const, content: [{ type: "text" as const, text: roundDirective.trim() }] }]
        : trimmed;
      const resp = await callLLMWithTools(system, messagesForCall, READER_TOOLS, abortController.signal);
      totalTokensUsed += (resp.meta.tokens_in || 0) + (resp.meta.tokens_out || 0);
      await logEvent("explore:llm_call", { turn: state.value.turnCount, phase: "reader", round, tokens_in: resp.meta.tokens_in, tokens_out: resp.meta.tokens_out, latency_ms: resp.meta.latency_ms, tools_count: resp.toolCalls.length, elapsed_ms: elapsed(), system, messages: trimmed }, "internal");

      if (resp.toolCalls.length === 0) {
        state.value.phase = "observing";
        const findings = earlyFindings || parseFindings(resp.text);
        await applyFindings(findings, resp.text);
        return findings;
      }

      const assistantContent: any[] = [];
      if (resp.text) assistantContent.push({ type: "text", text: resp.text });
      for (const tc of resp.toolCalls) {
        assistantContent.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
        options.onBlock({ kind: BlockKind.Tool, tool: { id: tc.id, name: tc.name, input: JSON.stringify(tc.input), isRunning: true, expanded: false } });
      }
      messages.push({ role: "assistant", content: assistantContent });

      const toolResults: any[] = [];
      for (const tc of resp.toolCalls) {
        if (tc.name === "report_findings") {
          const inputObj = safeInput(tc.input);
          let rawFindings = inputObj.findings || [];
          if (typeof rawFindings === "string") { try { rawFindings = JSON.parse(rawFindings); } catch { rawFindings = []; } }
          if (!Array.isArray(rawFindings)) rawFindings = [];
          const reported: Finding[] = rawFindings.map((f: any) => ({
            topic: f.topic || "", content: f.content || "", source: f.source || "", confirmed: false,
          }));
          toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: "Findings recorded." });
          options.onBlock({ kind: BlockKind.Tool, tool: { id: tc.id, name: tc.name, input: JSON.stringify(inputObj), isRunning: false, expanded: false } });
          earlyFindings = reported;
        } else if (tc.name === "AskUserQuestion") {
          const inputObj = safeInput(tc.input);
          const questions = (inputObj.questions || []).map((q: any) => ({
            header: q.header,
            question: q.question,
            options: (q.options || []).map((o: any) => typeof o === "string" ? o : { label: o.label, description: o.description }),
          }));
          options.onBlock({ kind: BlockKind.AskUser, toolUseId: tc.id, questions, answered: false, activeTab: 0 });
          options.onBlock({ kind: BlockKind.Tool, tool: { id: tc.id, name: tc.name, input: JSON.stringify(inputObj), isRunning: false, expanded: false } });
          await logEvent("explore:question", { questions }, "user");
          state.value.phase = "waiting_user";
          options.onStreaming(false);
          const answer = await waitForAnswer();
          options.onStreaming(true);
          state.value.phase = "acting";
          toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: answer });
        } else {
          await logEvent("explore:tool_call", { turn: state.value.turnCount, tool_name: tc.name, input: tc.input, round, elapsed_ms: elapsed() }, "user");
          const result = await execTool(tc.name, tc.input, options.workDir);
          const outputPreview = result.content.length > 200 ? result.content.slice(0, 200) + "..." : result.content;
          await logEvent("explore:tool_result", { turn: state.value.turnCount, tool_name: tc.name, output_preview: outputPreview, output_length: result.content.length, is_error: result.is_error, duration_ms: result.duration_ms, round, elapsed_ms: elapsed() }, "user");

          // Offload: 大结果存缓存，messages 里只留预览引用
          let messageContent = result.content;
          if (!result.is_error && contextCache.shouldOffload(result.content)) {
            messageContent = contextCache.offload(tc.id, tc.name, tc.input, result.content);
          }

          toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: messageContent, is_error: result.is_error });
          options.onBlock({ kind: BlockKind.Tool, tool: { id: tc.id, name: tc.name, input: JSON.stringify(tc.input), result: outputPreview, isError: result.is_error, isRunning: false, expanded: false } });
        }
      }
      messages.push({ role: "user", content: toolResults });

      // Track read paths for dedup
      for (const tc of resp.toolCalls) {
        const inp = safeInput(tc.input);
        if (tc.name === "glob" && inp.pattern) {
          state.value.filesRead.push(`glob:${inp.pattern}`);
        } else if (tc.name === "read_file" && inp.path) {
          state.value.filesRead.push(inp.path);
        } else if (tc.name === "search" && inp.query) {
          state.value.filesRead.push(`search:${inp.query}`);
        }
      }

      // If report_findings was called, we can end early
      if (earlyFindings) {
        state.value.phase = "observing";
        await applyFindings(earlyFindings, "");
        return earlyFindings;
      }
    }

    // 5 rounds exhausted without report_findings — force a final call with only report_findings tool
    state.value.phase = "observing";
    const REPORT_ONLY_TOOL = [READER_TOOLS.find(t => t.name === "report_findings")!];
    const forceMsg: LlmMessage = { role: "user", content: [{ type: "text", text: "你已经读取了足够的信息。请立即调用 report_findings 工具，将你目前了解到的所有发现整理为结构化的 findings 报告。每条 finding 必须有 topic、content 和 source。" }] };
    const forceMsgs = [...trimMessages(messages), forceMsg];
    const lastResp = await callLLMWithTools(system, forceMsgs, REPORT_ONLY_TOOL, abortController.signal);

    let findings: Finding[] = earlyFindings || [];
    if (lastResp.toolCalls.length > 0) {
      for (const tc of lastResp.toolCalls) {
        if (tc.name === "report_findings") {
          const inputObj = safeInput(tc.input);
          let rawFindings = inputObj.findings || [];
          if (typeof rawFindings === "string") { try { rawFindings = JSON.parse(rawFindings); } catch { rawFindings = []; } }
          if (!Array.isArray(rawFindings)) rawFindings = [];
          findings = rawFindings.map((f: any) => ({
            topic: f.topic || "", content: f.content || "", source: f.source || "", confirmed: false,
          }));
        }
      }
    }
    if (findings.length === 0) {
      findings = parseFindings(lastResp.text);
    }
    await applyFindings(findings, lastResp.text);
    return findings;
  }

  // --- PLACEHOLDER_APPLY_AND_BELOW ---

  async function applyFindings(findings: Finding[], rawText: string) {
    const newText = findings.length > 0
      ? findings.map(f => `[${f.topic}] ${f.content} (${f.source})`).join("\n")
      : `[无新发现] 已读路径: ${state.value.filesRead.slice(-5).join(", ") || "无"}`;

    if (findings.length > 0) {
      state.value.findings.push(...findings);
      logEvent("explore:observation", { findings }, "internal");
    }

    const combined = (state.value.runningSummary ? state.value.runningSummary + "\n" : "") + newText;
    if (estimateTokens(combined) > summarizeThreshold) {
      await compressSummary(newText);
    } else {
      state.value.runningSummary = combined;
    }

    // 文档模式：代码 findings 不直接填入需求文档
    // 文档填充由用户回答驱动（见 handleUserInput 中的 updateDocFromUserAnswer）
  }

  async function compressSummary(newText: string) {
    const prompt = buildExploreSummarizerPrompt({
      currentSummary: state.value.runningSummary || "（空）",
      newFindings: newText,
    });
    try {
      const { text: compressed, meta } = await callLLM("你是一个文本压缩助手。", prompt, undefined, abortController.signal);
      await logEvent("explore:llm_call", { turn: state.value.turnCount, phase: "summarizer", tokens_in: meta.tokens_in, tokens_out: meta.tokens_out, latency_ms: meta.latency_ms, tools_count: 0, elapsed_ms: elapsed(), system: "你是一个文本压缩助手。", messages: prompt }, "internal");

      // Dynamic threshold calibration
      const actualIn = meta.tokens_in;
      const estimated = estimateTokens(state.value.runningSummary + "\n" + newText);
      if (estimated > 0 && Math.abs(actualIn - estimated) / actualIn > 0.3) {
        summarizeThreshold = Math.round(summarizeThreshold * (actualIn / estimated));
        summarizeThreshold = Math.max(400, Math.min(1500, summarizeThreshold));
      }

      const oldSummary = state.value.runningSummary;
      state.value.runningSummary = compressed.trim();
      await logEvent("explore:summary_update", { before: oldSummary, after: state.value.runningSummary, elapsed_ms: elapsed() }, "internal");
    } catch (e: any) {
      if (e.name === "AbortError") throw e;
      /* keep existing summary on other errors */
    }
  }

  async function updateDocFromUserAnswer(userAnswer: string) {
    try {
      const oldSections = state.value.documentSections.map(s => ({ ...s }));
      // 将用户回答 + 技术背景摘要一起传给 docUpdater
      // docUpdater prompt 会将用户决策转化为需求规格语言
      const context = `[用户需求决策]\n${userAnswer}\n\n[技术背景（仅供理解上下文，不要直接写入文档）]\n${state.value.runningSummary}`;
      const result = await runDocUpdater(
        state.value.documentSections,
        context,
        state.value.runningSummary,
        abortController.signal,
      );
      if (result.updates.length > 0) {
        state.value.documentSections = applySectionUpdates(state.value.documentSections, result);
        docHistory.commit(oldSections, state.value.documentSections, "用户回答");
        await writeDocToFile();
        const diffs = result.updates.map(u => {
          const oldSec = oldSections.find(s => s.id === u.section_id);
          return { sectionId: u.section_id, oldContent: oldSec?.content || "", newContent: u.content };
        });
        await saveDocDiff("用户回答", diffs);
        await logEvent("explore:doc_update", { source: "user_answer", updates: result.updates.map(u => u.section_id), progress: getDocProgress(state.value.documentSections) }, "internal");
      }
    } catch (e: any) {
      if (e.name === "AbortError") throw e;
    }
  }

  async function writeDocToFile() {
    if (!state.value.documentName) {
      console.warn("[ExploreAgent] writeDocToFile skipped: no documentName");
      return;
    }
    const markdown = assembleMarkdown(state.value.documentSections, state.value.documentName);
    const progressJson = JSON.stringify(getDocProgress(state.value.documentSections));

    try {
      if (state.value.requirementDocId) {
        await updateRequirementDoc(state.value.requirementDocId, {
          content: markdown,
          progress_json: progressJson,
          source: "explore",
        });
      } else {
        const res = await createRequirementDoc({
          change_id: options.changeId || options.sessionId,
          session_id: options.sessionId,
          name: state.value.documentName,
          content: markdown,
          progress_json: progressJson,
        });
        if (res.ok && res.data) {
          state.value.requirementDocId = res.data.id;
        }
      }
    } catch (e) {
      console.error("[ExploreAgent] writeDocToFile API error:", e);
    }
  }

  function persistDocumentName(docName: string) {
    // 将 documentName 写入 session metadata，确保刷新后能恢复
    const existingMeta = options.metadata || {};
    const merged = { ...existingMeta, documentName: docName };
    authFetch(`/api/sessions/${options.sessionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: JSON.stringify(merged) }),
    }).catch(() => { /* best effort */ });
  }

  async function executeConfirmRequirement(params: { title: string }) {
    state.value.phase = "waiting_user";
    const markdown = assembleMarkdown(state.value.documentSections, params.title || state.value.documentName);
    options.onBlock({ kind: BlockKind.RequirementReview, documentName: state.value.documentName, content: markdown, confirmed: false });
    options.onStreaming(false);
    await logEvent("explore:confirm_requirement", { title: params.title, progress: getDocProgress(state.value.documentSections) }, "user");
  }

  async function generateTasksAndFinalize(title: string) {
    state.value.phase = "acting";
    options.onBlock({ kind: BlockKind.Text, content: "正在生成任务文档..." });
    options.onStreaming(true);

    try {
      const requirementContent = assembleMarkdown(state.value.documentSections, title);
      const tasksMarkdown = await runTaskGenerator(requirementContent, options.workDir, abortController.signal);

      // 确保需求文档已保存到 DB
      if (!state.value.requirementDocId) {
        const docRes = await createRequirementDoc({
          change_id: options.changeId || options.sessionId,
          session_id: options.sessionId,
          name: title,
          content: requirementContent,
          progress_json: JSON.stringify(getDocProgress(state.value.documentSections)),
        });
        if (docRes.ok && docRes.data) {
          state.value.requirementDocId = docRes.data.id;
        }
      } else {
        await updateRequirementDoc(state.value.requirementDocId, {
          content: requirementContent,
          status: "confirmed",
          source: "confirm",
        });
      }

      // 创建 Change 记录（不再传本地路径）
      const res = await authFetch("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: title,
          explore_summary: state.value.runningSummary,
          session_id: options.sessionId,
          tasks_content: tasksMarkdown,
        }),
      });
      if (res.ok) {
        await logEvent("explore:complete", { title }, "user");
      }
    } catch (e: any) {
      if (e.name === "AbortError") return;
      options.onBlock({ kind: BlockKind.Error, content: `任务生成失败: ${e.message}` });
    }

    state.value.phase = "done";
    options.onStreaming(false);
    options.onComplete();
  }

  function emitAskUser(params: { questions: Array<{ header: string; question: string; options: Array<{ label: string; description?: string }> }> }) {
    state.value.phase = "waiting_user";
    const questionsForUI = params.questions.map(q => ({
      header: q.header,
      question: q.question,
      options: q.options.map(o => typeof o === "string" ? o : { label: o.label, description: o.description }),
    }));
    options.onBlock({ kind: BlockKind.AskUser, toolUseId: `explore_ask_${Date.now()}`, questions: questionsForUI, answered: false, activeTab: 0 });
    logEvent("explore:question", { questions: params.questions }, "user");

    // 将提问内容追加到 runningSummary，保持对话连贯性
    const questionsSummary = params.questions.map(q => `[提问] ${q.question}`).join("\n");
    state.value.runningSummary = (state.value.runningSummary ? state.value.runningSummary + "\n" : "") + questionsSummary;
  }

  async function executeFinalize(params: { title: string }) {
    state.value.phase = "done";
    const statusMsg = `探索完成: ${params.title}`;
    options.onBlock({ kind: BlockKind.Text, content: statusMsg });

    try {
      const res = await authFetch("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: params.title, explore_summary: state.value.runningSummary, session_id: options.sessionId }),
      });
      if (res.ok) {
        await logEvent("explore:complete", { title: params.title, summary: state.value.runningSummary }, "user");
      }
    } catch (e: any) {
      options.onBlock({ kind: BlockKind.Error, content: `创建 Change 失败: ${e.message}` });
    }
    options.onComplete();
  }

  async function reactLoop(userInput: string, images?: Array<{ media_type: string; data: string }>) {
    let consecutiveReads = 0;
    let consecutiveErrors = 0;
    let degradeCount = 0;
    let noGainCount = 0;
    let consecutiveAsks = 0;
    let lastFindingsCount = state.value.findings.length;
    let cumulativeTokens = totalTokensUsed; // 动态 token 预算追踪

    while (state.value.phase !== "done" && state.value.phase !== "waiting_user" && state.value.phase !== "cancelled") {
      if (abortController.signal.aborted) return;
      cumulativeTokens = totalTokensUsed; // 同步最新累计值
      state.value.turnCount++;
      const tokenBudgetWarn = cumulativeTokens > TOKEN_BUDGET_WARN;
      // 当 token 预算紧张时，降低 summarizer 压缩阈值
      if (tokenBudgetWarn && summarizeThreshold > 500) {
        summarizeThreshold = Math.max(400, summarizeThreshold - 200);
      }
      const action = await runPlannerStep(userInput, images, { consecutiveReads, tokenBudgetWarn });
      if (!action) break;

      userInput = "";
      images = undefined;

      switch (action.action) {
        case "read_code":
          consecutiveReads++;
          consecutiveAsksTotal = 0; // planner 开始读代码，重置连续提问计数
          if (consecutiveReads > HARD_MAX_READS) {
            await executeFinalize({ title: "探索达到上限，自动结束" });
            return;
          }
          if (consecutiveReads > getMaxReads()) {
            emitAskUser({ questions: [{ header: "确认方向", question: "已阅读多轮代码，是否继续当前方向？", options: [{ label: "继续" }, { label: "换个方向" }, { label: "结束探索" }] }] });
            return;
          }
          try {
            await executeReadCode(action.params, action.reasoning);
            consecutiveErrors = 0;
            // Check information gain
            if (state.value.findings.length === lastFindingsCount) {
              noGainCount++;
              if (noGainCount >= 2) {
                emitAskUser({ questions: [{ header: "进展停滞", question: "连续多轮未发现新信息，是否继续？", options: [{ label: "继续探索" }, { label: "结束探索" }] }] });
                return;
              }
            } else {
              noGainCount = 0;
              lastFindingsCount = state.value.findings.length;
            }
          } catch (e: any) {
            if (e.name === "AbortError") return;
            consecutiveErrors++;
            await logEvent("explore:error", { phase: "reader", error: e.message, consecutiveErrors, elapsed_ms: elapsed() }, "user");
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              // Degrade: skip this objective, continue
              degradeCount++;
              consecutiveErrors = 0;
              state.value.runningSummary += `\n[跳过] ${action.params.objective} (连续错误)`;
              options.onBlock({ kind: BlockKind.Error, content: `跳过目标: ${action.params.objective}（连续错误）` });
              if (degradeCount >= 2) {
                emitAskUser({ questions: [{ header: "多次降级", question: "已多次因错误跳过目标，是否继续？", options: [{ label: "继续" }, { label: "结束探索" }] }] });
                return;
              }
            }
          }
          break;
        case "ask_user":
          consecutiveReads = 0;
          consecutiveAsks++;
          consecutiveAsksTotal++;
          // 极端保护：连续 ask_user 超过 5 轮，强制进入 read_code
          if (consecutiveAsksTotal > 5) {
            options.onBlock({ kind: BlockKind.Text, content: "已多轮提问，开始基于已有信息探索代码..." });
            consecutiveAsksTotal = 0;
            // 强制转为 read_code
            try {
              await executeReadCode({ objective: "基于已有需求信息，了解项目整体结构和相关模块" }, "连续提问过多，自动转为代码探索");
            } catch (e: any) {
              if (e.name === "AbortError") return;
            }
            break;
          }
          emitAskUser(action.params);
          return;
        case "confirm_requirement":
          await executeConfirmRequirement(action.params);
          return;
        case "finalize":
          await executeFinalize(action.params);
          return;
        default:
          options.onBlock({ kind: BlockKind.Error, content: `未知 action: ${(action as any).action}` });
          return;
      }
    }
  }

  async function handleUserInput(content: string, images?: Array<{ media_type: string; data: string }>) {
    if (state.value.phase === "done" || state.value.phase === "cancelled") return;

    // If waiting for user answer (from AskUserQuestion in tool loop), resolve the pending promise
    if (answerResolver) {
      options.onBlock({ kind: BlockKind.User, content });
      await logEvent("explore:answer", { content }, "user");
      resolveAnswer(content);
      return;
    }

    options.onStreaming(true);
    options.onBlock({ kind: BlockKind.User, content });

    if (isFirstTurn.value) {
      // 初始化文档模式：仅在 documentSections 为空时（非恢复场景）才加载模板
      if (state.value.documentSections.length === 0) {
        await initDocumentMode();
      }
      // 如果没有 documentName，从用户输入生成一个
      if (!state.value.documentName && state.value.documentSections.length > 0) {
        state.value.documentName = content.slice(0, 30).replace(/\n/g, " ").trim() || "需求文档";
        // 持久化 documentName 到 session metadata，刷新后可恢复
        persistDocumentName(state.value.documentName);
      }
      // 立即将用户原始需求写入第一个 section，面板即时显示有内容的文档
      // 仅在全新会话时（sections 刚从模板初始化，内容为空）才覆写 section[0]
      if (state.value.documentSections.length > 0 && !state.value.documentSections.some(s => s.status === "filled")) {
        const oldSections = state.value.documentSections.map(s => ({ ...s }));
        state.value.documentSections = state.value.documentSections.map((sec, idx) =>
          idx === 0
            ? { ...sec, content: content, status: "filled" as const }
            : sec
        );
        docHistory.commit(oldSections, state.value.documentSections, "用户回答");
        // 第一次输入就生成文档文件，后续探索持续填充
        await writeDocToFile();
        await saveDocDiff("用户回答", [{ sectionId: state.value.documentSections[0]?.id || "", oldContent: "", newContent: content }]);
      }
      isFirstTurn.value = false;
    }

    await logEvent("explore:answer", { content }, "user");

    // 将用户回答累积到 runningSummary，确保 planner 始终有完整上下文
    const entry = `[回答] ${content}`;
    const combined = (state.value.runningSummary ? state.value.runningSummary + "\n" : "") + entry;
    if (estimateTokens(combined) > summarizeThreshold) {
      await compressSummary(entry);
    } else {
      state.value.runningSummary = combined;
    }

    // 文档模式：用户回答驱动文档填充，将用户决策转化为需求规格
    if (state.value.documentSections.length > 0) {
      await updateDocFromUserAnswer(content);
    }

    // 用户刚做了关键决策时，追加深入信号防止 planner 过早收敛
    let plannerInput = content;
    if (!isFirstTurn.value && state.value.turnCount > 0) {
      // 非首轮且已有探索历史 = 用户在回答 Agent 的提问，属于关键决策
      plannerInput = content + "\n（用户刚做了关键决策，请基于此决策继续 read_code 细化技术方案，不要立即收敛）";
    }

    try {
      await reactLoop(plannerInput, images);
    } finally {
      options.onStreaming(false);
    }
  }

  /** 处理需求文档确认后的操作 */
  async function handleRequirementConfirm(confirmed: boolean) {
    if (confirmed) {
      const title = state.value.documentName || "需求文档";
      await generateTasksAndFinalize(title);
    } else {
      // 用户选择继续编辑，恢复到探索循环
      state.value.phase = "idle";
      options.onStreaming(false);
    }
  }

  /** 初始化文档模式 */
  async function initDocumentMode() {
    const meta = options.metadata;

    // 从 metadata 获取文档名称
    const docName = meta?.documentName || meta?.changeName || "";
    if (docName) state.value.documentName = docName;

    // 尝试获取需求模板（即使没有 metadata 也尝试加载默认模板）
    try {
      const res = await authFetch("/api/templates?category=requirement");
      if (res.ok) {
        const json = await res.json();
        const templates = json.data || [];
        if (templates.length > 0) {
          const template = meta?.templateId
            ? templates.find((t: any) => t.id === meta.templateId) || templates[0]
            : templates[0];
          state.value.templateId = template.id;
          state.value.documentSections = parseTemplateToSections(template.content);
          docHistory.initFromSections(state.value.documentSections);
        }
      }
    } catch {
      // 无模板时不启用文档模式
    }
  }

  function resume() {
    if (state.value.phase === "waiting_user") {
      state.value.phase = "idle";
    }
  }

  function markDone() {
    state.value.phase = "done";
  }

  /** 从 API 恢复 documentSections（页面刷新/历史加载时） */
  async function restoreDocFromFile() {
    const meta = options.metadata;
    const docName = meta?.documentName || "";
    if (!docName) {
      console.warn("[ExploreAgent] restoreDocFromFile skipped: no docName");
      return;
    }

    state.value.documentName = docName;

    const changeId = options.changeId || options.sessionId;
    try {
      const res = await getRequirementDocByChange(changeId);
      if (res.ok && res.data) {
        state.value.requirementDocId = res.data.id;
        const sections = parseMarkdownToSections(res.data.content);
        if (sections.length > 0) {
          state.value.documentSections = sections;
          docHistory.initFromSections(sections);
          isFirstTurn.value = false;
        }
      }
    } catch (e) {
      console.error("[ExploreAgent] restoreDocFromFile error:", e);
    }
  }

  /** 从历史事件恢复 agent 运行状态（runningSummary, filesRead, turnCount）
   * 解决恢复历史后上下文丢失导致重复读文件的问题 */
  function restoreAgentState(allEvents: Array<{ event_type: string; payload: any }>) {
    // 找最后一个 summary_update 事件恢复 runningSummary
    let lastSummary = "";
    let restoredFilesRead: string[] = [];
    let readCodeTurns = 0;

    for (const ev of allEvents) {
      const p = typeof ev.payload === "string" ? JSON.parse(ev.payload) : ev.payload;
      switch (ev.event_type) {
        case "explore:summary_update":
          if (p.after) lastSummary = p.after;
          break;
        case "explore:tool_call":
          if (p.tool_name === "glob" && p.input?.pattern) {
            restoredFilesRead.push(`glob:${p.input.pattern}`);
          } else if (p.tool_name === "read_file" && p.input?.path) {
            restoredFilesRead.push(p.input.path);
          } else if (p.tool_name === "search" && p.input?.query) {
            restoredFilesRead.push(`search:${p.input.query}`);
          }
          break;
        case "explore:action":
          if (p.action === "read_code") readCodeTurns++;
          break;
        case "explore:answer":
          // 如果没有 summary_update（未触发压缩），从用户回答重建摘要
          if (!lastSummary && p.content) {
            lastSummary = (lastSummary ? lastSummary + "\n" : "") + `[回答] ${p.content}`;
          }
          break;
      }
    }

    if (lastSummary) {
      state.value.runningSummary = lastSummary;
    }
    if (restoredFilesRead.length > 0) {
      state.value.filesRead = restoredFilesRead;
    }
    if (readCodeTurns > 0) {
      state.value.turnCount = readCodeTurns;
      isFirstTurn.value = false;
    }
  }

  async function undoDoc() {
    const snapshot = docHistory.undo();
    if (snapshot) {
      state.value.documentSections = snapshot;
      await writeDocToFile();
    }
  }

  async function redoDoc() {
    const snapshot = docHistory.redo();
    if (snapshot) {
      state.value.documentSections = snapshot;
      await writeDocToFile();
    }
  }

  async function editSection(sectionId: string, newContent: string) {
    const oldSections = state.value.documentSections.map(s => ({ ...s }));
    const oldContent = oldSections.find(s => s.id === sectionId)?.content || "";
    state.value.documentSections = state.value.documentSections.map(sec =>
      sec.id === sectionId
        ? { ...sec, content: newContent, status: newContent.trim() ? "filled" as const : "empty" as const }
        : sec
    );
    docHistory.commit(oldSections, state.value.documentSections, "用户编辑");
    await writeDocToFile();
    await saveDocDiff("用户编辑", [{ sectionId, oldContent, newContent }]);
  }

  return { state, handleUserInput, handleRequirementConfirm, resume, cancel, markDone, docHistory, undoDoc, redoDoc, editSection, restoreDocFromFile, restoreAgentState };
}
