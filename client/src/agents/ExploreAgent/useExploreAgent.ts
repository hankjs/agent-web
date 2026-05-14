import { ref } from "vue";
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

  function elapsed() { return Date.now() - startTime; }

  // Pause/resume mechanism for AskUserQuestion inside tool loop
  let answerResolver: ((answer: string) => void) | null = null;

  function waitForAnswer(): Promise<string> {
    return new Promise(resolve => { answerResolver = resolve; });
  }

  function resolveAnswer(answer: string) {
    if (answerResolver) { answerResolver(answer); answerResolver = null; }
  }

  function getInitialAreas(): string[] {
    const meta = options.metadata;
    if (!meta) return [];
    return meta.focusAreas || [];
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

  async function runPlannerStep(userInput: string, images?: Array<{ media_type: string; data: string }>): Promise<PlannerAction | null> {
    state.value.phase = "thinking";
    const uncovered = state.value.uncoveredAreas.length > 0
      ? state.value.uncoveredAreas.join("、")
      : "由 agent 根据上下文判断";
    const prompt = buildExplorePlannerPrompt({
      summary: state.value.runningSummary || "（尚未开始探索）",
      uncoveredAreas: uncovered,
      userInput,
    });
    await logEvent("explore:thought", { prompt_preview: prompt.slice(0, 200) }, "internal");
    options.onBlock({ kind: "text", content: "正在规划下一步..." });

    const MAX_PLANNER_RETRIES = 2;
    let lastError = "";

    for (let attempt = 0; attempt <= MAX_PLANNER_RETRIES; attempt++) {
      try {
        const systemPrompt = attempt === 0
          ? "你是一个 JSON 输出机器，只返回合法 JSON。"
          : `你是一个 JSON 输出机器，只返回合法 JSON。\n\n上次输出失败原因: ${lastError}\n请严格只输出一个 JSON 对象，不要包含任何其他文字。`;
        const { text: response, meta, httpStatus } = await callLLM(systemPrompt, prompt, images);
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
        await logEvent("explore:action", action, "internal");
        return action;
      } catch (e: any) {
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

  async function executeReadCode(params: { objective: string; files_hint?: string[] }) {
    state.value.phase = "acting";
    const statusMsg = `正在阅读代码: ${params.objective}`;
    options.onBlock({ kind: "text", content: statusMsg });
    await logEvent("explore:status", { message: statusMsg }, "user");

    const system = buildExploreReaderPrompt({
      objective: params.objective + (params.files_hint?.length ? `\n提示文件: ${params.files_hint.join(", ")}` : ""),
      workDir: options.workDir,
    });

    let messages: LlmMessage[] = [{ role: "user", content: [{ type: "text", text: "开始阅读。" }] }];
    const MAX_TOOL_ROUNDS = 5;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const resp = await callLLMWithTools(system, messages, READER_TOOLS);
      await logEvent("explore:llm_call", { turn: state.value.turnCount, phase: "reader", round, tokens_in: resp.meta.tokens_in, tokens_out: resp.meta.tokens_out, latency_ms: resp.meta.latency_ms, tools_count: resp.toolCalls.length, elapsed_ms: elapsed() }, "internal");

      if (resp.toolCalls.length === 0) {
        state.value.phase = "observing";
        const findings = parseFindings(resp.text);
        applyFindings(findings, resp.text);
        return;
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
        if (tc.name === "AskUserQuestion") {
          // Emit ask_user block and pause for user answer
          const questions = (tc.input.questions || []).map((q: any) => ({
            header: q.header,
            question: q.question,
            options: (q.options || []).map((o: any) => typeof o === "string" ? o : o.label),
          }));
          options.onBlock({ kind: "ask_user", toolUseId: tc.id, questions, answered: false, activeTab: 0 });
          state.value.phase = "waiting_user";
          const answer = await waitForAnswer();
          state.value.phase = "acting";
          toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: answer });
        } else {
          await logEvent("explore:tool_call", { turn: state.value.turnCount, tool_name: tc.name, input: tc.input, round, elapsed_ms: elapsed() }, "internal");
          const result = await execTool(tc.name, tc.input, options.workDir);
          const outputPreview = result.content.length > 200 ? result.content.slice(0, 200) + "..." : result.content;
          await logEvent("explore:tool_result", { turn: state.value.turnCount, tool_name: tc.name, output_preview: outputPreview, output_length: result.content.length, is_error: result.is_error, duration_ms: result.duration_ms, round, elapsed_ms: elapsed() }, "internal");
          toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: result.content, is_error: result.is_error });
        }
      }
      messages.push({ role: "user", content: toolResults });
    }

    state.value.phase = "observing";
    const lastResp = await callLLMWithTools(system, messages, []);
    const findings = parseFindings(lastResp.text);
    applyFindings(findings, lastResp.text);
  }

  function applyFindings(findings: Finding[], rawText: string) {
    if (findings.length > 0) {
      state.value.findings.push(...findings);
      for (const f of findings) {
        state.value.uncoveredAreas = state.value.uncoveredAreas.filter(
          a => !f.topic.includes(a) && !f.content.includes(a)
        );
      }
      logEvent("explore:observation", { findings }, "internal");
      if (state.value.turnCount % 2 === 0 && state.value.findings.length >= 3) {
        compressSummary(findings);
      } else {
        const newBits = findings.map(f => `[${f.topic}] ${f.content}`).join("; ");
        state.value.runningSummary += (state.value.runningSummary ? "\n" : "") + newBits;
      }
    } else {
      state.value.runningSummary += (state.value.runningSummary ? "\n" : "") + rawText.slice(0, 300);
    }
  }

  async function compressSummary(newFindings: Finding[]) {
    const findingsText = newFindings.map(f => `- [${f.topic}] ${f.content} (${f.source})`).join("\n");
    const prompt = buildExploreSummarizerPrompt({
      currentSummary: state.value.runningSummary || "（空）",
      newFindings: findingsText,
    });
    try {
      const { text: compressed, meta } = await callLLM("你是一个文本压缩助手。", prompt);
      await logEvent("explore:llm_call", { turn: state.value.turnCount, phase: "summarizer", tokens_in: meta.tokens_in, tokens_out: meta.tokens_out, latency_ms: meta.latency_ms, tools_count: 0, elapsed_ms: elapsed() }, "internal");
      const oldSummary = state.value.runningSummary;
      state.value.runningSummary = compressed.trim();
      await logEvent("explore:summary_update", { before: oldSummary, after: state.value.runningSummary, elapsed_ms: elapsed() }, "internal");
    } catch { /* keep existing */ }
  }

  function emitAskUser(params: { questions: Array<{ header: string; question: string; options: Array<{ label: string; description?: string }> }> }) {
    state.value.phase = "waiting_user";
    const questionsForUI = params.questions.map(q => ({
      header: q.header,
      question: q.question,
      options: q.options.map(o => typeof o === "string" ? o : o.label),
    }));
    options.onBlock({ kind: "ask_user", toolUseId: `explore_ask_${Date.now()}`, questions: questionsForUI, answered: false, activeTab: 0 });
    // Log full options (with descriptions) for admin trace
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
    const MAX_CONSECUTIVE_READS = 6;
    let consecutiveReads = 0;

    while (state.value.phase !== "done" && state.value.phase !== "waiting_user") {
      state.value.turnCount++;
      const action = await runPlannerStep(userInput, images);
      if (!action) break;

      userInput = "";
      images = undefined;

      switch (action.action) {
        case "read_code":
          consecutiveReads++;
          if (consecutiveReads > MAX_CONSECUTIVE_READS) {
            emitAskUser({ questions: [{ header: "确认方向", question: "已阅读多轮代码，是否继续当前方向？", options: [{ label: "继续" }, { label: "换个方向" }, { label: "结束探索" }] }] });
            return;
          }
          await executeReadCode(action.params);
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
    if (state.value.phase === "done") return;

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

  return { state, handleUserInput, resume };
}
