import type { LlmMessage, LlmResponse, LlmMeta, ToolUseBlock } from "./types";
import { authFetch } from "../../composables/useSession";
import { execToolLocal } from "./localTools";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/** Exponential backoff with jitter */
function backoffDelay(attempt: number): number {
  const delay = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = delay * 0.2 * Math.random();
  return delay + jitter;
}

/** Determine if an error/response is retryable */
function isRetryable(res?: Response, err?: any): boolean {
  if (err) return true; // network errors are retryable
  if (res && res.status >= 500) return true;
  if (res && res.status === 429) return true;
  return false;
}

/** Fetch with exponential backoff retry for transient failures */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await authFetch(url, init);
      if (res.ok || !isRetryable(res)) return res;
      // Retryable server error
      lastError = new Error(`LLM error: ${res.status}`);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, backoffDelay(attempt)));
      }
    } catch (err: any) {
      lastError = err;
      if (attempt < MAX_RETRIES && isRetryable(undefined, err)) {
        await new Promise(r => setTimeout(r, backoffDelay(attempt)));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

/** Call LLM via server proxy — no tools, pure text completion */
export async function callLLM(system: string, userText: string, images?: Array<{ media_type: string; data: string }>): Promise<{ text: string; meta: LlmMeta }> {
  const start = performance.now();
  const content: Array<{ type: string; [key: string]: any }> = [];
  if (images && images.length > 0) {
    for (const img of images) {
      content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } });
    }
  }
  content.push({ type: "text", text: userText });
  const messages: LlmMessage[] = [{ role: "user", content }];
  const res = await fetchWithRetry("/api/llm/completion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages, tools: [], max_tokens: 4096 }),
  });
  if (!res.ok) throw new Error(`LLM error: ${res.status}`);
  const { text, meta } = await readSSEText(res);
  meta.latency_ms = Math.round(performance.now() - start);
  return { text, meta };
}

/** Call LLM with tools — returns text + tool calls + metadata */
export async function callLLMWithTools(system: string, messages: LlmMessage[], tools: any[]): Promise<LlmResponse> {
  const start = performance.now();
  const res = await fetchWithRetry("/api/llm/completion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages, tools, max_tokens: 4096 }),
  });
  if (!res.ok) throw new Error(`LLM error: ${res.status}`);
  const result = await readSSEFull(res);
  result.meta.latency_ms = Math.round(performance.now() - start);
  return result;
}

/** Read SSE stream, return concatenated text + token metadata */
async function readSSEText(res: Response): Promise<{ text: string; meta: LlmMeta }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const meta: LlmMeta = { tokens_in: 0, tokens_out: 0, latency_ms: 0 };
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
        else if (ev.type === "message_end") {
          if (ev.usage) { meta.tokens_in = ev.usage.input_tokens || 0; meta.tokens_out = ev.usage.output_tokens || 0; }
        }
        else if (ev.type === "error") throw new Error(ev.message);
      } catch (e: any) { if (e.message?.startsWith("LLM")) throw e; }
    }
  }
  return { text, meta };
}

/** Read SSE stream, return text + tool calls + metadata */
async function readSSEFull(res: Response): Promise<LlmResponse> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const toolCalls: ToolUseBlock[] = [];
  let currentTool: { id: string; name: string; inputJson: string } | null = null;
  let stopReason = "end_turn";
  const meta: LlmMeta = { tokens_in: 0, tokens_out: 0, latency_ms: 0 };

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
            if (ev.usage) { meta.tokens_in = ev.usage.input_tokens || 0; meta.tokens_out = ev.usage.output_tokens || 0; }
            break;
          case "error": throw new Error(ev.message);
        }
      } catch (e: any) { if (e.message?.startsWith("LLM")) throw e; }
    }
  }
  return { text, toolCalls, stopReason, meta };
}

/** Execute a tool — routes to local (Tauri) or server based on environment */
export async function execTool(toolName: string, input: any, workDir: string): Promise<{ content: string; is_error: boolean; duration_ms: number }> {
  const start = performance.now();

  // Tauri environment → local execution
  if ((window as any).__TAURI_INTERNALS__) {
    const result = await execToolLocal(toolName, input, workDir);
    return { ...result, duration_ms: result.duration_ms || Math.round(performance.now() - start) };
  }

  // Browser environment → server execution
  const res = await authFetch("/api/llm/tool-exec", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: toolName, input, work_dir: workDir }),
  });
  const duration_ms = Math.round(performance.now() - start);
  if (!res.ok) return { content: `Tool exec failed: ${res.status}`, is_error: true, duration_ms };
  const json = await res.json();
  const data = json.data || { content: "No result", is_error: true };
  return { ...data, duration_ms };
}
