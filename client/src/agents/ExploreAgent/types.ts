export interface Finding {
  topic: string;
  content: string;
  source: string;
  confirmed: boolean;
}

export interface DocumentSection {
  id: string;        // 模板中的章节标识
  title: string;     // 章节标题
  content: string;   // 当前填充内容
  status: "empty" | "partial" | "filled";
}

export type ExplorePhase = "idle" | "thinking" | "acting" | "observing" | "waiting_user" | "done" | "cancelled";

export interface ExploreAgentState {
  phase: ExplorePhase;
  runningSummary: string;
  findings: Finding[];
  uncoveredAreas: string[];
  turnCount: number;
  filesRead: string[];
  documentSections: DocumentSection[];
  documentName: string;
  templateId: string | null;
  requirementDocId: string | null;
}

export type AskUserOption = string | { label: string; description?: string };

export type AskUserQuestion = {
  header: string;
  question: string;
  options: AskUserOption[];
  selected?: string;
  customMode?: boolean;
  customAnswer?: string;
};

/** Block 类型枚举 */
export const enum BlockKind {
  User = "user",
  Text = "text",
  Thinking = "thinking",
  Error = "error",
  Tool = "tool",
  ExploreRound = "explore_round",
  PlannerDecision = "planner_decision",
  AskUser = "ask_user",
  RequirementReview = "requirement_review",
}

/** 后端事件类型枚举 */
export const enum ExploreEvent {
  Answer = "explore:answer",
  Action = "explore:action",
  ToolCall = "explore:tool_call",
  ToolResult = "explore:tool_result",
  Status = "explore:status",
  Error = "explore:error",
  Question = "explore:question",
  Complete = "explore:complete",
}

export type Block =
  | { kind: BlockKind.User; content: string; images?: Array<{ media_type: string; data: string }>; messageId?: string; parentId?: string | null }
  | { kind: BlockKind.Text; content: string }
  | { kind: BlockKind.Thinking; content: string }
  | { kind: BlockKind.Error; content: string }
  | { kind: BlockKind.Tool; tool: { id: string; name: string; input?: string; result?: string; isError?: boolean; isRunning: boolean; expanded: boolean } }
  | { kind: BlockKind.ExploreRound; objective: string; reasoning?: string; tools: Array<{ id: string; name: string; input?: string; result?: string; isError?: boolean; isRunning: boolean; expanded: boolean }>; expanded: boolean; isRunning: boolean }
  | { kind: BlockKind.PlannerDecision; reasoning: string; action: string; objective?: string; expanded: boolean }
  | { kind: BlockKind.AskUser; toolUseId: string; questions: AskUserQuestion[]; answered: boolean; activeTab: number }
  | { kind: BlockKind.RequirementReview; documentName: string; content: string; confirmed: boolean };

export interface ExploreAgentOptions {
  sessionId: string;
  changeId?: string;
  metadata: Record<string, any> | null;
  workDir: string;
  onBlock: (block: Block) => void;
  onStreaming: (v: boolean) => void;
  onComplete: () => void;
}

export interface PlannerAction {
  reasoning: string;
  action: "read_code" | "ask_user" | "finalize" | "confirm_requirement";
  params: any;
}

export interface LlmMessage {
  role: "user" | "assistant";
  content: Array<{ type: string; [key: string]: any }>;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: any;
}

export interface LlmMeta {
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
}

export interface LlmResponse {
  text: string;
  toolCalls: ToolUseBlock[];
  stopReason: string;
  meta: LlmMeta;
}
