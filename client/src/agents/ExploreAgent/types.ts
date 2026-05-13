export interface Finding {
  topic: string;
  content: string;
  source: string;
  confirmed: boolean;
}

export type ExplorePhase = "idle" | "thinking" | "acting" | "observing" | "waiting_user" | "done";

export interface ExploreAgentState {
  phase: ExplorePhase;
  runningSummary: string;
  findings: Finding[];
  uncoveredAreas: string[];
  turnCount: number;
}

export type AskUserQuestion = {
  header: string;
  question: string;
  options: string[];
  selected?: string;
  customMode?: boolean;
  customAnswer?: string;
};

export type Block =
  | { kind: "user"; content: string; images?: Array<{ media_type: string; data: string }>; messageId?: string; parentId?: string | null }
  | { kind: "text"; content: string }
  | { kind: "error"; content: string }
  | { kind: "tool"; tool: { id: string; name: string; input?: string; result?: string; isError?: boolean; isRunning: boolean; expanded: boolean } }
  | { kind: "ask_user"; toolUseId: string; questions: AskUserQuestion[]; answered: boolean; activeTab: number };

export interface ExploreAgentOptions {
  sessionId: string;
  metadata: Record<string, any> | null;
  workDir: string;
  onBlock: (block: Block) => void;
  onStreaming: (v: boolean) => void;
  onComplete: () => void;
}

export interface PlannerAction {
  reasoning: string;
  action: "read_code" | "ask_user" | "finalize";
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

export interface LlmResponse {
  text: string;
  toolCalls: ToolUseBlock[];
  stopReason: string;
}
