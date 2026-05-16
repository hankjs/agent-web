import { ref } from "vue";
import { encodingForModel } from "js-tiktoken";
import { authFetch } from "../../composables/useSession";
import {
  buildExplorePlannerPrompt,
  buildExploreReaderPrompt,
  buildExploreSummarizerPrompt,
} from "./prompts";
import { callLLM, callLLMWithTools, execTool } from "./llm";
import { READER_TOOLS, WRITER_TOOLS } from "./tools";
import {
  BlockKind,
  type ExploreAgentState,
  type ExploreAgentOptions,
  type ExplorePhase,
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
  runTaskGenerator,
} from "./docUpdater";

const enc = encodingForModel("gpt-4o"); // cl100k_base compatible

let summarizeThreshold = 800;

function estimateTokens(text: string): number {
  return enc.encode(text).length;
}

const HARD_MAX_READS = 20;
const MAX_FULL_ROUNDS = 3;
const MAX_CONSECUTIVE_ERRORS = 3;

export function useExploreAgent(options: ExploreAgentOptions) {
  const state = ref<ExploreAgentState>({
    phase: "idle",
    runningSummary: "",
    findings: [],
    uncoveredAreas: [],
    turnCount: 0,
    filesRead: [],
    documentSections: [],
    documentName: "",
    templateId: null,
  });

  const isFirstTurn = ref(true);
  const startTime = Date.now();
  let abortController = new AbortController();
  let consecutiveAsksTotal = 0; // 跨 reactLoop 调用追踪连续 ask_user 次数

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

  function getInitialAreas(): string[] {
    const meta = options.metadata;
    if (!meta) return [];
    return meta.focusAreas || [];
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

  function parseFindings(text: string): Finding[] {
    const match = text.match(/```json:findings\s*\n([\s\S]*?)\n```/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[1]);
      return (parsed.findings || []).map((f: any) => ({
        topic: f.topic || "", content: f.content || "", source: f.source || "", confirmed: false,
      }));
    } catch { return []; }
  }

  /** Sliding window: trim old tool rounds to keep context manageable */
  function trimMessages(msgs: LlmMessage[]): LlmMessage[] {
    const rounds = (msgs.length - 1) / 2;
    if (rounds <= MAX_FULL_ROUNDS) return msgs;
    const trimCount = Math.floor(rounds - MAX_FULL_ROUNDS);
    const trimmed: LlmMessage[] = [msgs[0]];
    let summary = "（前几轮工具调用摘要）\n";
    for (let i = 0; i < trimCount; i++) {
      const aIdx = 1 + i * 2;
      const toolNames = msgs[aIdx].content
        .filter((b: any) => b.type === "tool_use")
        .map((b: any) => b.name);
      summary += `- 调用了 ${toolNames.join(", ")}\n`;
    }
    trimmed.push({ role: "user", content: [{ type: "text", text: summary }] });
    trimmed.push(...msgs.slice(1 + trimCount * 2));
    return trimmed;
  }

  // --- PLACEHOLDER_PLANNER_AND_BELOW ---

  async function runPlannerStep(userInput: string, images?: Array<{ media_type: string; data: string }>): Promise<PlannerAction | null> {
    state.value.phase = "thinking";
    const prompt = buildExplorePlannerPrompt({
      summary: state.value.runningSummary || "（尚未开始探索）",
      userInput,
      turnCount: state.value.turnCount,
      maxTurns: HARD_MAX_READS,
      findingsCount: state.value.findings.length,
      elapsedSec: Math.round(elapsed() / 1000),
      filesRead: state.value.filesRead,
      docProgress: getDocProgress(state.value.documentSections),
    });
    await logEvent("explore:thought", { prompt_preview: prompt.slice(0, 200) }, "internal");
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

    const system = buildExploreReaderPrompt({
      objective: params.objective + (params.files_hint?.length ? `\n提示文件: ${params.files_hint.join(", ")}` : ""),
      workDir: options.workDir,
    });

    let messages: LlmMessage[] = [{ role: "user", content: [{ type: "text", text: "开始阅读。" }] }];
    const MAX_TOOL_ROUNDS = 5;
    let earlyFindings: Finding[] | null = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const trimmed = trimMessages(messages);
      const resp = await callLLMWithTools(system, trimmed, READER_TOOLS, abortController.signal);
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
          const reported: Finding[] = (tc.input.findings || []).map((f: any) => ({
            topic: f.topic || "", content: f.content || "", source: f.source || "", confirmed: false,
          }));
          toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: "Findings recorded." });
          options.onBlock({ kind: BlockKind.Tool, tool: { id: tc.id, name: tc.name, input: JSON.stringify(tc.input), isRunning: false, expanded: false } });
          earlyFindings = reported;
        } else if (tc.name === "AskUserQuestion") {
          const questions = (tc.input.questions || []).map((q: any) => ({
            header: q.header,
            question: q.question,
            options: (q.options || []).map((o: any) => typeof o === "string" ? o : { label: o.label, description: o.description }),
          }));
          options.onBlock({ kind: BlockKind.AskUser, toolUseId: tc.id, questions, answered: false, activeTab: 0 });
          options.onBlock({ kind: BlockKind.Tool, tool: { id: tc.id, name: tc.name, input: JSON.stringify(tc.input), isRunning: false, expanded: false } });
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
          toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: result.content, is_error: result.is_error });
          options.onBlock({ kind: BlockKind.Tool, tool: { id: tc.id, name: tc.name, input: JSON.stringify(tc.input), result: outputPreview, isError: result.is_error, isRunning: false, expanded: false } });
        }
      }
      messages.push({ role: "user", content: toolResults });

      // Track read paths for dedup
      for (const tc of resp.toolCalls) {
        if (tc.name === "glob" && tc.input.pattern) {
          state.value.filesRead.push(`glob:${tc.input.pattern}`);
        } else if (tc.name === "read_file" && tc.input.path) {
          state.value.filesRead.push(tc.input.path);
        } else if (tc.name === "search" && tc.input.query) {
          state.value.filesRead.push(`search:${tc.input.query}`);
        }
      }

      // If report_findings was called, we can end early
      if (earlyFindings) {
        state.value.phase = "observing";
        await applyFindings(earlyFindings, "");
        return earlyFindings;
      }
    }

    state.value.phase = "observing";
    const lastResp = await callLLMWithTools(system, trimMessages(messages), [], abortController.signal);
    const findings = earlyFindings || parseFindings(lastResp.text);
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
      for (const f of findings) {
        state.value.uncoveredAreas = state.value.uncoveredAreas.filter(
          a => !f.topic.includes(a) && !f.content.includes(a)
        );
      }
      logEvent("explore:observation", { findings }, "internal");
    }

    const combined = (state.value.runningSummary ? state.value.runningSummary + "\n" : "") + newText;
    if (estimateTokens(combined) > summarizeThreshold) {
      await compressSummary(newText);
    } else {
      state.value.runningSummary = combined;
    }

    // 文档模式：调用 doc_updater 更新章节
    if (state.value.documentSections.length > 0 && findings.length > 0) {
      await updateDocSections(newText);
    }
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

  async function updateDocSections(newFindings: string) {
    try {
      const result = await runDocUpdater(
        state.value.documentSections,
        newFindings,
        state.value.runningSummary,
        abortController.signal,
      );
      if (result.updates.length > 0) {
        state.value.documentSections = applySectionUpdates(state.value.documentSections, result);
        await writeDocToFile();
        await logEvent("explore:doc_update", { updates: result.updates.map(u => u.section_id), progress: getDocProgress(state.value.documentSections) }, "internal");
      }
    } catch (e: any) {
      if (e.name === "AbortError") throw e;
      // doc update failure is non-fatal
    }
  }

  async function writeDocToFile() {
    if (!state.value.documentName || !options.workDir) return;
    const markdown = assembleMarkdown(state.value.documentSections, state.value.documentName);
    const dirPath = `${options.workDir}/docs/changes/${state.value.documentName.replace(/[^a-zA-Z0-9\u4e00-\u9fff-]/g, "-")}`;
    const filePath = `${dirPath}/requirement.md`;
    try {
      // 使用 Tauri write_file 命令（通过 execTool 的 shell 工具）
      await execTool("shell", { command: `mkdir -p "${dirPath}" && cat > "${filePath}" << 'HANK_EOF'\n${markdown}\nHANK_EOF` }, options.workDir);
    } catch {
      // 写入失败不阻塞流程
    }
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

      // 写入 tasks.md
      const dirPath = `${options.workDir}/docs/changes/${state.value.documentName.replace(/[^a-zA-Z0-9\u4e00-\u9fff-]/g, "-")}`;
      const tasksPath = `${dirPath}/tasks.md`;
      await execTool("shell", { command: `mkdir -p "${dirPath}" && cat > "${tasksPath}" << 'HANK_EOF'\n${tasksMarkdown}\nHANK_EOF` }, options.workDir);

      // 创建 Change 记录
      const reqPath = `${dirPath}/requirement.md`;
      const res = await authFetch("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: title,
          explore_summary: state.value.runningSummary,
          requirement_path: reqPath,
          tasks_path: tasksPath,
          session_id: options.sessionId,
        }),
      });
      if (res.ok) {
        await logEvent("explore:complete", { title, requirement_path: reqPath, tasks_path: tasksPath }, "user");
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

    while (state.value.phase !== "done" && state.value.phase !== "waiting_user" && state.value.phase !== "cancelled") {
      if (abortController.signal.aborted) return;
      state.value.turnCount++;
      const action = await runPlannerStep(userInput, images);
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
      state.value.uncoveredAreas = getInitialAreas();
      // 初始化文档模式：从 metadata 获取模板
      await initDocumentMode();
      // 立即将用户原始需求写入第一个 section，面板即时显示有内容的文档
      if (state.value.documentSections.length > 0) {
        state.value.documentSections = state.value.documentSections.map((sec, idx) =>
          idx === 0
            ? { ...sec, content: content, status: "filled" as const }
            : sec
        );
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

    // 文档模式：用户回答后也触发 doc_updater
    if (state.value.documentSections.length > 0) {
      await updateDocSections(`[用户回答] ${content}`);
    }

    try {
      await reactLoop(content, images);
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
    if (!meta) return;

    // 从 metadata 获取文档名称
    const docName = meta.documentName || meta.changeName || "";
    if (docName) state.value.documentName = docName;

    // 尝试获取需求模板
    try {
      const res = await authFetch("/api/templates?category=requirement");
      if (res.ok) {
        const templates = await res.json();
        if (templates.length > 0) {
          const template = meta.templateId
            ? templates.find((t: any) => t.id === meta.templateId) || templates[0]
            : templates[0];
          state.value.templateId = template.id;
          state.value.documentSections = parseTemplateToSections(template.content);
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

  return { state, handleUserInput, handleRequirementConfirm, resume, cancel, markDone };
}
