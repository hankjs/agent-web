export interface ToolCall {
  id: string;
  name: string;
  input?: string;
  result?: string;
  isError?: boolean;
  isRunning: boolean;
  expanded: boolean;
  source?: "local" | "remote";
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
  | { kind: "tool"; tool: ToolCall }
  | { kind: "ask_user"; toolUseId: string; questions: AskUserQuestion[]; answered: boolean; activeTab: number };

export type RenderItem =
  | { kind: "user"; content: string; images?: Array<{ media_type: string; data: string }>; messageId?: string; parentId?: string | null }
  | { kind: "text"; content: string }
  | { kind: "structured"; cardType: string; data: any }
  | { kind: "error"; content: string }
  | { kind: "tool"; tool: ToolCall }
  | { kind: "tool-group"; tools: ToolCall[] }
  | { kind: "ask_user"; toolUseId: string; questions: AskUserQuestion[]; answered: boolean; activeTab: number };
