import type { LlmMessage, LlmResponse, ToolUseBlock } from "./types";
import { authFetch } from "../../composables/useSession";

/** Call LLM via server proxy — no tools, pure text completion */
export async function callLLM(system: string, userText: string): Promise<string> {
  const messages: LlmMessage[] = [{ role: "user", content: [{ type: "text", text: userText }] }];
  const res = await authFetch("/api/llm/completion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages, tools: [], max_tokens: 4096 }),
  });
  if (!res.ok) throw new Error(`LLM error: ${res.status}`);
  return readSSEText(res);
}

/** Call LLM with tools — returns text + tool calls */
export async function callLLMWithTools(system: string, messages: LlmMessage[], tools: any[]): Promise<LlmResponse> {
  const res = await authFetch("/api/llm/completion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages, tools, max_tokens: 4096 }),
  });
  if (!res.ok) throw new Error(`LLM error: ${res.status}`);
  return readSSEFull(res);
}

/** Execute a tool via server */
export async function execTool(toolName: string, input: any, workDir: string): Promise<{ content: string; is_error: boolean }> {
  const res = await authFetch("/api/llm/tool-exec", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: toolName, input, work_dir: workDir }),
  });
  if (!res.ok) return { content: `Tool exec failed: ${res.status}`, is_error: true };
  const json = await res.json();
  return json.data || { content: "No result", is_error: true };
}

/** Read SSE stream, return concatenated text */
async function readSSEText(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6);
      if (!json || json === "{}") continue;
      try {
        const ev = JSON.parse(json);
        if (ev.type === "text_delta") text += ev.text;
        else if (ev.type === "error") throw new Error(ev.message);
      } catch (e: any) { if (e.message?.startsWith("LLM")) throw e; }
    }
  }
  return text;
}

/** Read SSE stream, return text + tool calls */
async function readSSEFull(res: Response): Promise<LlmResponse> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const toolCalls: ToolUseBlock[] = [];
  let currentTool: { id: string; name: string; inputJson: string } | null = null;
  let stopReason = "end_turn";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6);
      if (!raw || raw === "{}") continue;
      try {
        const ev = JSON.parse(raw);
        switch (ev.type) {
          case "text_delta": text += ev.text; break;
          case "tool_use_start":
            currentTool = { id: ev.id, name: ev.name, inputJson: "" };
            break;
          case "tool_use_input_delta":
            if (currentTool) currentTool.inputJson += ev.delta;
            break;
          case "tool_use_end":
            if (currentTool) {
              let input: any = {};
              try { input = JSON.parse(currentTool.inputJson); } catch {}
              toolCalls.push({ type: "tool_use", id: currentTool.id, name: currentTool.name, input });
              currentTool = null;
            }
            break;
          case "message_end":
            stopReason = ev.stop_reason || "end_turn";
            break;
          case "error": throw new Error(ev.message);
        }
      } catch (e: any) { if (e.message?.startsWith("LLM")) throw e; }
    }
  }
  return { text, toolCalls, stopReason };
}
