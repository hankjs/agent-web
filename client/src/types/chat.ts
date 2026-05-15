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

/** Chat 所有 block/render 类型枚举 */
export const enum ChatBlockKind {
  User = "user",
  Text = "text",
  Error = "error",
  Tool = "tool",
  AskUser = "ask_user",
  Structured = "structured",
  ToolGroup = "tool-group",
}

export type Block =
  | { kind: ChatBlockKind.User; content: string; images?: Array<{ media_type: string; data: string }>; messageId?: string; parentId?: string | null }
  | { kind: ChatBlockKind.Text; content: string }
  | { kind: ChatBlockKind.Error; content: string }
  | { kind: ChatBlockKind.Tool; tool: ToolCall }
  | { kind: ChatBlockKind.AskUser; toolUseId: string; questions: AskUserQuestion[]; answered: boolean; activeTab: number };

export type RenderItem =
  | { kind: ChatBlockKind.User; content: string; images?: Array<{ media_type: string; data: string }>; messageId?: string; parentId?: string | null }
  | { kind: ChatBlockKind.Text; content: string }
  | { kind: ChatBlockKind.Structured; cardType: string; data: any }
  | { kind: ChatBlockKind.Error; content: string }
  | { kind: ChatBlockKind.Tool; tool: ToolCall }
  | { kind: ChatBlockKind.ToolGroup; tools: ToolCall[] }
  | { kind: ChatBlockKind.AskUser; toolUseId: string; questions: AskUserQuestion[]; answered: boolean; activeTab: number };
