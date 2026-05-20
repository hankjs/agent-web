import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// Mock llm module before importing useExploreAgent
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMWithTools: vi.fn(),
  execTool: vi.fn(),
  validateBashCommand: vi.fn(),
}));

// Mock authFetch — returns empty template list by default
vi.mock("../../composables/useSession", () => ({
  authFetch: vi.fn((url: string) => {
    // Template API returns empty list
    if (typeof url === "string" && url.includes("/api/templates")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: null }) });
  }),
}));

// Mock admin API
vi.mock("../../api/admin", () => ({
  createRequirementDoc: vi.fn(() => Promise.resolve({ ok: true, data: { id: "doc_1" } })),
  updateRequirementDoc: vi.fn(() => Promise.resolve({ ok: true })),
  getRequirementDocByChange: vi.fn(() => Promise.resolve({ ok: false })),
}));

import { useExploreAgent } from "./useExploreAgent";
import { callLLM, callLLMWithTools, execTool } from "./llm";
import { BlockKind, type Block, type ExploreAgentOptions } from "./types";

const mockCallLLM = callLLM as Mock;
const mockCallLLMWithTools = callLLMWithTools as Mock;
const mockExecTool = execTool as Mock;

function makeOptions(overrides: Partial<ExploreAgentOptions> = {}): ExploreAgentOptions {
  return {
    sessionId: "sess_1",
    metadata: {},
    workDir: "/test/project",
    onBlock: vi.fn(),
    onStreaming: vi.fn(),
    onComplete: vi.fn(),
    ...overrides,
  };
}

/** Helper: make planner return a specific action */
function mockPlannerAction(action: object, tokens = { tokens_in: 100, tokens_out: 50 }) {
  mockCallLLM.mockResolvedValueOnce({
    text: JSON.stringify(action),
    meta: { ...tokens, latency_ms: 200 },
    httpStatus: 200,
  });
}

/** Helper: make reader return findings via tool_use */
function mockReaderWithFindings(findings: Array<{ topic: string; content: string; source: string }>, tokens = { tokens_in: 200, tokens_out: 100 }) {
  mockCallLLMWithTools.mockResolvedValueOnce({
    text: "",
    toolCalls: [{
      type: "tool_use",
      id: `tc_report_${Date.now()}_${Math.random()}`,
      name: "report_findings",
      input: { findings },
    }],
    stopReason: "end_turn",
    meta: { ...tokens, latency_ms: 300 },
  });
}

describe("useExploreAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations to avoid leaking mockResolvedValue across tests
    mockCallLLM.mockReset();
    mockCallLLMWithTools.mockReset();
    mockExecTool.mockReset();
  });

  describe("basic exploration flow", () => {
    it("executes planner → reader → finalize cycle", async () => {
      const opts = makeOptions();
      const { handleUserInput, state } = useExploreAgent(opts);

      // Planner: read_code
      mockPlannerAction({
        reasoning: "需要了解项目结构",
        action: "read_code",
        params: { objective: "了解项目结构" },
      });

      // Reader: report findings
      mockReaderWithFindings([
        { topic: "项目结构", content: "Vue 3 + TypeScript", source: "package.json" },
      ]);

      // Planner: finalize
      mockPlannerAction({
        reasoning: "信息足够",
        action: "finalize",
        params: { title: "探索完成" },
      });

      await handleUserInput("分析这个项目");

      expect(state.value.phase).toBe("done");
      expect(state.value.findings.length).toBe(1);
      expect(state.value.findings[0].topic).toBe("项目结构");
    });

    it("emits ask_user and pauses for user response", async () => {
      const opts = makeOptions();
      const { handleUserInput, state } = useExploreAgent(opts);

      // Planner: ask_user
      mockPlannerAction({
        reasoning: "需要确认方向",
        action: "ask_user",
        params: {
          questions: [{
            header: "方向",
            question: "你想探索哪个方向？",
            options: [{ label: "前端" }, { label: "后端" }],
          }],
        },
      });

      await handleUserInput("开始探索");

      expect(state.value.phase).toBe("waiting_user");
      const blocks = (opts.onBlock as Mock).mock.calls.map(c => c[0] as Block);
      const askBlock = blocks.find(b => b.kind === BlockKind.AskUser);
      expect(askBlock).toBeDefined();
    });
  });

  describe("hard token budget", () => {
    it("force finalizes when token budget exceeded", async () => {
      const opts = makeOptions();
      const { handleUserInput, state } = useExploreAgent(opts);

      // Each planner + reader cycle burns ~20000 tokens
      // TOKEN_BUDGET_HARD = 50000, so 3 rounds should trigger it
      for (let i = 0; i < 4; i++) {
        mockPlannerAction(
          { reasoning: `探索第${i + 1}轮`, action: "read_code", params: { objective: `目标${i}` } },
          { tokens_in: 8000, tokens_out: 3000 },
        );
        mockReaderWithFindings(
          [{ topic: `发现${i}`, content: `内容${i}`, source: `file${i}.ts` }],
          { tokens_in: 6000, tokens_out: 3000 },
        );
      }

      await handleUserInput("深度探索");

      // Should have been force-finalized due to token budget
      expect(state.value.phase).toBe("done");
      const blocks = (opts.onBlock as Mock).mock.calls.map(c => c[0] as Block);
      const budgetBlock = blocks.find(
        b => b.kind === BlockKind.Text && (b as any).content.includes("Token 预算已耗尽")
      );
      expect(budgetBlock).toBeDefined();
    });
  });

  describe("circuit breaker", () => {
    it("trips after consecutive LLM failures across calls", async () => {
      const opts = makeOptions();
      const { handleUserInput, state } = useExploreAgent(opts);

      // First handleUserInput: planner fails 3 times (MAX_PLANNER_RETRIES=2, so attempts 0,1,2)
      // circuitBreakerFailures reaches 3, planner returns null, reactLoop ends
      for (let i = 0; i < 3; i++) {
        mockCallLLM.mockRejectedValueOnce(new Error("LLM error: 500"));
      }

      await handleUserInput("第一次");
      // Phase should not be done yet (planner failed but CB threshold=5 not reached)
      // Actually when planner returns null, reactLoop just breaks and streaming stops

      // Second handleUserInput: planner fails 3 more times
      // circuitBreakerFailures reaches 6, which is >= 5
      // But the CB check is at the top of the while loop, so:
      // - Turn 1 of second call: CB=3, passes check → planner fails 3 times → CB=6 → returns null → loop iterates
      // - Turn 2 of second call: CB=6 >= 5 → trips!
      for (let i = 0; i < 3; i++) {
        mockCallLLM.mockRejectedValueOnce(new Error("LLM error: 500"));
      }

      await handleUserInput("第二次");

      expect(state.value.phase).toBe("done");
      const blocks = (opts.onBlock as Mock).mock.calls.map(c => c[0] as Block);
      const cbBlock = blocks.find(
        b => b.kind === BlockKind.Error && (b as any).content.includes("熔断")
      );
      expect(cbBlock).toBeDefined();
    });
  });

  describe("soft read limit", () => {
    it("asks user when exceeding soft max reads (standard=8)", async () => {
      const opts = makeOptions();
      const { handleUserInput, state } = useExploreAgent(opts);

      // 9 rounds of read_code to exceed standard depth (8)
      for (let i = 0; i < 10; i++) {
        mockPlannerAction({
          reasoning: `继续探索第${i + 1}轮`,
          action: "read_code",
          params: { objective: `目标${i}` },
        });
        mockReaderWithFindings([
          { topic: `发现${i}`, content: `新内容${i}`, source: `file${i}.ts` },
        ]);
      }

      await handleUserInput("探索");

      // Should pause to ask user at soft limit
      expect(state.value.phase).toBe("waiting_user");
    });
  });

  describe("parallel tool execution", () => {
    it("calls execTool for multiple read-only tools", async () => {
      const opts = makeOptions();
      const { handleUserInput } = useExploreAgent(opts);

      // Planner: read_code
      mockPlannerAction({
        reasoning: "需要读文件",
        action: "read_code",
        params: { objective: "了解代码" },
      });

      // Reader returns multiple tool calls
      mockCallLLMWithTools.mockResolvedValueOnce({
        text: "",
        toolCalls: [
          { type: "tool_use", id: "tc_1", name: "glob", input: { pattern: "**/*.ts" } },
          { type: "tool_use", id: "tc_2", name: "read_file", input: { path: "src/main.ts" } },
          { type: "tool_use", id: "tc_3", name: "search", input: { pattern: "export" } },
        ],
        stopReason: "tool_use",
        meta: { tokens_in: 200, tokens_out: 100, latency_ms: 300 },
      });

      // Mock all three tool executions
      mockExecTool.mockResolvedValue({ content: "result", is_error: false, duration_ms: 10 });

      // Round 2: report findings
      mockCallLLMWithTools.mockResolvedValueOnce({
        text: "",
        toolCalls: [{
          type: "tool_use",
          id: "tc_report",
          name: "report_findings",
          input: { findings: [{ topic: "test", content: "found", source: "main.ts" }] },
        }],
        stopReason: "end_turn",
        meta: { tokens_in: 200, tokens_out: 100, latency_ms: 300 },
      });

      // Planner: finalize
      mockPlannerAction({
        reasoning: "完成",
        action: "finalize",
        params: { title: "done" },
      });

      await handleUserInput("分析");

      // All 3 read-only tools should have been called
      expect(mockExecTool).toHaveBeenCalledTimes(3);
      expect(mockExecTool).toHaveBeenCalledWith("glob", { pattern: "**/*.ts" }, "/test/project");
      expect(mockExecTool).toHaveBeenCalledWith("read_file", { path: "src/main.ts" }, "/test/project");
      expect(mockExecTool).toHaveBeenCalledWith("search", { pattern: "export" }, "/test/project");
    });
  });

  describe("cancel", () => {
    it("aborts and sets phase to cancelled", () => {
      const opts = makeOptions();
      const { cancel, state } = useExploreAgent(opts);

      cancel();

      expect(state.value.phase).toBe("cancelled");
      expect(opts.onComplete).toHaveBeenCalled();
    });

    it("subsequent handleUserInput is no-op after cancel", async () => {
      const opts = makeOptions();
      const { cancel, handleUserInput, state } = useExploreAgent(opts);

      cancel();
      await handleUserInput("should be ignored");

      expect(state.value.phase).toBe("cancelled");
      expect(mockCallLLM).not.toHaveBeenCalled();
    });
  });

  describe("loop detection in reader", () => {
    it("injects nudge when reader repeats same tool calls", async () => {
      const opts = makeOptions();
      const { handleUserInput } = useExploreAgent(opts);

      // Planner: read_code
      mockPlannerAction({
        reasoning: "阅读代码",
        action: "read_code",
        params: { objective: "了解结构" },
      });

      // Reader: same tool call repeated, then reports
      // Round 1
      mockCallLLMWithTools.mockResolvedValueOnce({
        text: "",
        toolCalls: [{ type: "tool_use", id: "tc_r1", name: "read_file", input: { path: "same.ts" } }],
        stopReason: "tool_use",
        meta: { tokens_in: 100, tokens_out: 50, latency_ms: 100 },
      });
      mockExecTool.mockResolvedValueOnce({ content: "file content", is_error: false, duration_ms: 10 });

      // Round 2 (same fingerprint → triggers loop detection at LOOP_THRESHOLD=2)
      mockCallLLMWithTools.mockResolvedValueOnce({
        text: "",
        toolCalls: [{ type: "tool_use", id: "tc_r2", name: "read_file", input: { path: "same.ts" } }],
        stopReason: "tool_use",
        meta: { tokens_in: 100, tokens_out: 50, latency_ms: 100 },
      });
      mockExecTool.mockResolvedValueOnce({ content: "file content", is_error: false, duration_ms: 10 });

      // Round 3: after nudge, model reports findings
      mockReaderWithFindings([{ topic: "结构", content: "Vue项目", source: "same.ts" }]);

      // Planner: finalize
      mockPlannerAction({
        reasoning: "完成",
        action: "finalize",
        params: { title: "done" },
      });

      await handleUserInput("分析");

      // callLLMWithTools should have been called 3+ times (2 tool rounds + 1 report)
      expect(mockCallLLMWithTools.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("planner JSON parsing", () => {
    it("parses clean JSON response directly", async () => {
      const opts = makeOptions();
      const { handleUserInput, state } = useExploreAgent(opts);

      mockCallLLM.mockResolvedValueOnce({
        text: '{"reasoning":"思考","action":"finalize","params":{"title":"完成"}}',
        meta: { tokens_in: 50, tokens_out: 30, latency_ms: 100 },
        httpStatus: 200,
      });

      await handleUserInput("快速完成");
      expect(state.value.phase).toBe("done");
    });

    it("extracts JSON from response with extra text", async () => {
      const opts = makeOptions();
      const { handleUserInput, state } = useExploreAgent(opts);

      mockCallLLM.mockResolvedValueOnce({
        text: 'Here is the JSON:\n{"reasoning":"思考","action":"finalize","params":{"title":"完成"}}\nDone.',
        meta: { tokens_in: 50, tokens_out: 30, latency_ms: 100 },
        httpStatus: 200,
      });

      await handleUserInput("快速完成");
      expect(state.value.phase).toBe("done");
    });

    it("retries on empty response then succeeds", async () => {
      const opts = makeOptions();
      const { handleUserInput, state } = useExploreAgent(opts);

      // First attempt: empty
      mockCallLLM.mockResolvedValueOnce({
        text: "",
        meta: { tokens_in: 50, tokens_out: 0, latency_ms: 100 },
        httpStatus: 200,
      });
      // Second attempt: valid
      mockCallLLM.mockResolvedValueOnce({
        text: '{"reasoning":"重试成功","action":"finalize","params":{"title":"ok"}}',
        meta: { tokens_in: 50, tokens_out: 30, latency_ms: 100 },
        httpStatus: 200,
      });

      await handleUserInput("测试");
      expect(state.value.phase).toBe("done");
      expect(mockCallLLM).toHaveBeenCalledTimes(2);
    });
  });

  describe("restoreAgentState", () => {
    it("restores summary, filesRead, and turnCount from events", () => {
      const opts = makeOptions();
      const { restoreAgentState, state } = useExploreAgent(opts);

      restoreAgentState([
        { event_type: "explore:summary_update", payload: { after: "恢复的摘要" } },
        { event_type: "explore:tool_call", payload: { tool_name: "read_file", input: { path: "src/main.ts" } } },
        { event_type: "explore:tool_call", payload: { tool_name: "glob", input: { pattern: "**/*.ts" } } },
        { event_type: "explore:tool_call", payload: { tool_name: "search", input: { query: "export" } } },
        { event_type: "explore:action", payload: { action: "read_code" } },
        { event_type: "explore:action", payload: { action: "read_code" } },
      ]);

      expect(state.value.runningSummary).toBe("恢复的摘要");
      expect(state.value.filesRead).toContain("src/main.ts");
      expect(state.value.filesRead).toContain("glob:**/*.ts");
      expect(state.value.filesRead).toContain("search:export");
      expect(state.value.turnCount).toBe(2);
    });

    it("handles stringified payloads", () => {
      const opts = makeOptions();
      const { restoreAgentState, state } = useExploreAgent(opts);

      restoreAgentState([
        { event_type: "explore:summary_update", payload: JSON.stringify({ after: "字符串摘要" }) },
      ]);

      expect(state.value.runningSummary).toBe("字符串摘要");
    });
  });

  describe("findings accumulation", () => {
    it("accumulates findings across multiple reader rounds", async () => {
      const opts = makeOptions();
      const { handleUserInput, state } = useExploreAgent(opts);

      // Round 1: read_code with findings
      mockPlannerAction({ reasoning: "第一轮", action: "read_code", params: { objective: "了解结构" } });
      mockReaderWithFindings([
        { topic: "结构", content: "Monorepo", source: "package.json" },
      ]);

      // Round 2: read_code with more findings
      mockPlannerAction({ reasoning: "第二轮", action: "read_code", params: { objective: "了解 API" } });
      mockReaderWithFindings([
        { topic: "API", content: "REST", source: "routes.ts" },
        { topic: "认证", content: "JWT", source: "auth.ts" },
      ]);

      // Finalize
      mockPlannerAction({ reasoning: "完成", action: "finalize", params: { title: "done" } });

      await handleUserInput("分析");

      expect(state.value.findings.length).toBe(3);
      expect(state.value.findings.map(f => f.topic)).toEqual(["结构", "API", "认证"]);
    });
  });

  describe("markDone", () => {
    it("sets phase to done", () => {
      const opts = makeOptions();
      const { markDone, state } = useExploreAgent(opts);
      markDone();
      expect(state.value.phase).toBe("done");
    });
  });

  describe("resume", () => {
    it("resets waiting_user to idle", () => {
      const opts = makeOptions();
      const { resume, state } = useExploreAgent(opts);

      state.value.phase = "waiting_user";
      resume();
      expect(state.value.phase).toBe("idle");
    });

    it("does nothing if not waiting_user", () => {
      const opts = makeOptions();
      const { resume, state } = useExploreAgent(opts);

      state.value.phase = "acting";
      resume();
      expect(state.value.phase).toBe("acting");
    });
  });
});
