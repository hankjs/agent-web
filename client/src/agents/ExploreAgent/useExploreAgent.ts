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
import type {
  ExploreAgentState,
  ExploreAgentOptions,
  ExplorePhase,
  Finding,
  PlannerAction,
  LlmMessage,
  Block,
} from "./types";

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
  });

  const isFirstTurn = ref(true);
  const startTime = Date.now();
  let abortController = new AbortController();

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
    options.onBlock({ kind: "text", content: "探索已取消。" });
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
    const uncovered = state.value.uncoveredAreas.length > 0
      ? state.value.uncoveredAreas.join("、")
      : "由 agent 根据上下文判断";
    const prompt = buildExplorePlannerPrompt({
      summary: state.value.runningSummary || "（尚未开始探索）",
      uncoveredAreas: uncovered,
      userInput,
      turnCount: state.value.turnCount,
      maxTurns: HARD_MAX_READS,
      findingsCount: state.value.findings.length,
      elapsedSec: Math.round(elapsed() / 1000),
    });
    await logEvent("explore:thought", { prompt_preview: prompt.slice(0, 200) }, "internal");
    // Emit a thinking block that will stream planner output
    const thinkingBlock = { kind: "thinking" as const, content: "" };
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
          options.onBlock({ kind: "thinking", content: thinkingBlock.content });
        });
        await logEvent("explore:llm_call", { turn: state.value.turnCount, phase: "planner", attempt, tokens_in: meta.tokens_in, tokens_out: meta.tokens_out, latency_ms: meta.latency_ms, tools_count: 0, elapsed_ms: elapsed(), httpStatus }, "internal");

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
        options.onBlock({ kind: "error", content: `规划失败: ${e.message}` });
        return null;
      }
    }
    return null;
  }

  async function executeReadCode(params: { objective: string; files_hint?: string[] }, reasoning?: string): Promise<Finding[]> {
    state.value.phase = "acting";
    const statusMsg = `正在阅读代码: ${params.objective}`;
    // Emit an explore_round block that groups all tool calls for this read
    options.onBlock({ kind: "explore_round", objective: params.objective, reasoning, tools: [], expanded: true, isRunning: true } as any);
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
      await logEvent("explore:llm_call", { turn: state.value.turnCount, phase: "reader", round, tokens_in: resp.meta.tokens_in, tokens_out: resp.meta.tokens_out, latency_ms: resp.meta.latency_ms, tools_count: resp.toolCalls.length, elapsed_ms: elapsed() }, "internal");

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
        options.onBlock({ kind: "tool", tool: { id: tc.id, name: tc.name, input: JSON.stringify(tc.input), isRunning: true, expanded: false } });
      }
      messages.push({ role: "assistant", content: assistantContent });

      const toolResults: any[] = [];
      for (const tc of resp.toolCalls) {
        if (tc.name === "report_findings") {
          const reported: Finding[] = (tc.input.findings || []).map((f: any) => ({
            topic: f.topic || "", content: f.content || "", source: f.source || "", confirmed: false,
          }));
          toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: "Findings recorded." });
          options.onBlock({ kind: "tool", tool: { id: tc.id, name: tc.name, input: JSON.stringify(tc.input), isRunning: false, expanded: false } });
          earlyFindings = reported;
        } else if (tc.name === "AskUserQuestion") {
          const questions = (tc.input.questions || []).map((q: any) => ({
            header: q.header,
            question: q.question,
            options: (q.options || []).map((o: any) => typeof o === "string" ? o : { label: o.label, description: o.description }),
          }));
          options.onBlock({ kind: "ask_user", toolUseId: tc.id, questions, answered: false, activeTab: 0 });
          options.onBlock({ kind: "tool", tool: { id: tc.id, name: tc.name, input: JSON.stringify(tc.input), isRunning: false, expanded: false } });
          state.value.phase = "waiting_user";
          const answer = await waitForAnswer();
          state.value.phase = "acting";
          toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: answer });
        } else {
          await logEvent("explore:tool_call", { turn: state.value.turnCount, tool_name: tc.name, input: tc.input, round, elapsed_ms: elapsed() }, "user");
          const result = await execTool(tc.name, tc.input, options.workDir);
          const outputPreview = result.content.length > 200 ? result.content.slice(0, 200) + "..." : result.content;
          await logEvent("explore:tool_result", { turn: state.value.turnCount, tool_name: tc.name, output_preview: outputPreview, output_length: result.content.length, is_error: result.is_error, duration_ms: result.duration_ms, round, elapsed_ms: elapsed() }, "user");
          toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: result.content, is_error: result.is_error });
          options.onBlock({ kind: "tool", tool: { id: tc.id, name: tc.name, input: JSON.stringify(tc.input), result: outputPreview, isError: result.is_error, isRunning: false, expanded: false } });
        }
      }
      messages.push({ role: "user", content: toolResults });

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
      : rawText.slice(0, 300);

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
  }

  async function compressSummary(newText: string) {
    const prompt = buildExploreSummarizerPrompt({
      currentSummary: state.value.runningSummary || "（空）",
      newFindings: newText,
    });
    try {
      const { text: compressed, meta } = await callLLM("你是一个文本压缩助手。", prompt, undefined, abortController.signal);
      await logEvent("explore:llm_call", { turn: state.value.turnCount, phase: "summarizer", tokens_in: meta.tokens_in, tokens_out: meta.tokens_out, latency_ms: meta.latency_ms, tools_count: 0, elapsed_ms: elapsed() }, "internal");

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

  function emitAskUser(params: { questions: Array<{ header: string; question: string; options: Array<{ label: string; description?: string }> }> }) {
    state.value.phase = "waiting_user";
    const questionsForUI = params.questions.map(q => ({
      header: q.header,
      question: q.question,
      options: q.options.map(o => typeof o === "string" ? o : { label: o.label, description: o.description }),
    }));
    options.onBlock({ kind: "ask_user", toolUseId: `explore_ask_${Date.now()}`, questions: questionsForUI, answered: false, activeTab: 0 });
    logEvent("explore:question", { questions: params.questions }, "user");
  }

  async function executeFinalize(params: { title: string }) {
    state.value.phase = "done";
    const statusMsg = `探索完成: ${params.title}`;
    options.onBlock({ kind: "text", content: statusMsg });
    await logEvent("explore:status", { message: statusMsg }, "user");

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
      options.onBlock({ kind: "error", content: `创建 Change 失败: ${e.message}` });
    }
    options.onComplete();
  }

  async function reactLoop(userInput: string, images?: Array<{ media_type: string; data: string }>) {
    let consecutiveReads = 0;
    let consecutiveErrors = 0;
    let degradeCount = 0;
    let noGainCount = 0;
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
              options.onBlock({ kind: "error", content: `跳过目标: ${action.params.objective}（连续错误）` });
              if (degradeCount >= 2) {
                emitAskUser({ questions: [{ header: "多次降级", question: "已多次因错误跳过目标，是否继续？", options: [{ label: "继续" }, { label: "结束探索" }] }] });
                return;
              }
            }
          }
          break;
        case "ask_user":
          consecutiveReads = 0;
          emitAskUser(action.params);
          return;
        case "finalize":
          await executeFinalize(action.params);
          return;
        default:
          options.onBlock({ kind: "error", content: `未知 action: ${(action as any).action}` });
          return;
      }
    }
  }

  async function handleUserInput(content: string, images?: Array<{ media_type: string; data: string }>) {
    if (state.value.phase === "done" || state.value.phase === "cancelled") return;

    // If waiting for user answer (from AskUserQuestion in tool loop), resolve the pending promise
    if (answerResolver) {
      resolveAnswer(content);
      return;
    }

    options.onStreaming(true);
    options.onBlock({ kind: "user", content });

    if (isFirstTurn.value) {
      state.value.uncoveredAreas = getInitialAreas();
      isFirstTurn.value = false;
    }

    await logEvent("explore:answer", { content }, "user");

    try {
      await reactLoop(content, images);
    } finally {
      options.onStreaming(false);
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

  return { state, handleUserInput, resume, cancel, markDone };
}
