import type { LlmMessage, LlmResponse, LlmMeta, ToolUseBlock } from "./types";
import { authFetch } from "../../composables/useSession";
import { execToolLocal } from "./localTools";
import { API_BASE } from "../../config";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/** Exponential backoff with jitter */
function backoffDelay(attempt: number): number {
  const delay = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = delay * 0.2 * Math.random();
  return delay + jitter;
}

/** Get auth token from localStorage */
function getToken(): string {
  return localStorage.getItem("hank_client_token") || "";
}

/** Check if running inside Tauri */
function isTauri(): boolean {
  return !!(window as any).__TAURI_INTERNALS__;
}

/**
 * Stream SSE via Tauri invoke + app.emit events.
 * Uses global event listener instead of Channel (Channel batches events until invoke resolves).
 */
function streamSSEViaTauri(
  url: string,
  body: string,
  signal: AbortSignal | undefined,
  onLine: (data: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
): () => void {
  let aborted = false;
  let unlisten: (() => void) | null = null;

  const streamId = `sse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const run = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");

      // Listen for events with our stream_id
      unlisten = await listen<{ stream_id: string; data: string; done: boolean }>("llm-stream-event", (event) => {
        if (aborted) return;
        if (event.payload.stream_id !== streamId) return;
        if (event.payload.done) {
          onDone();
        } else if (event.payload.data) {
          onLine(event.payload.data);
        }
      });

      if (signal?.aborted) { onError(new DOMException("Aborted", "AbortError")); return; }

      // invoke fires events via app.emit during execution — no batching
      await invoke("llm_stream", {
        req: { url, token: getToken(), body, streamId },
      });
    } catch (err: any) {
      if (!aborted) {
        onError(new Error(err?.toString() || "Tauri invoke failed"));
      }
    } finally {
      if (unlisten) unlisten();
    }
  };

  run();

  if (signal) {
    signal.addEventListener("abort", () => { aborted = true; if (unlisten) unlisten(); });
  }

  return () => { aborted = true; if (unlisten) unlisten(); };
}

/**
 * SSE streaming via XHR (fallback for browser dev mode).
 */
function streamSSEViaXHR(
  url: string,
  body: string,
  signal: AbortSignal | undefined,
  onLine: (data: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
): () => void {
  const xhr = new XMLHttpRequest();
  xhr.open("POST", url, true);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.setRequestHeader("Authorization", `Bearer ${getToken()}`);
  xhr.setRequestHeader("Accept", "text/event-stream");

  let lastIndex = 0;

  xhr.onprogress = () => {
    const text = xhr.responseText.slice(lastIndex);
    lastIndex = xhr.responseText.length;
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        onLine(line.slice(6));
      }
    }
  };

  xhr.onload = () => {
    const text = xhr.responseText.slice(lastIndex);
    if (text) {
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          onLine(line.slice(6));
        }
      }
    }
    if (xhr.status >= 200 && xhr.status < 300) {
      onDone();
    } else {
      onError(new Error(`LLM error: ${xhr.status}`));
    }
  };

  xhr.onerror = () => onError(new Error("Network error"));
  xhr.onabort = () => onError(new DOMException("Aborted", "AbortError"));

  if (signal) {
    if (signal.aborted) { xhr.abort(); return () => {}; }
    signal.addEventListener("abort", () => xhr.abort());
  }

  xhr.send(body);
  return () => xhr.abort();
}

/** Route SSE to Tauri or XHR based on environment */
function streamSSE(
  url: string,
  body: string,
  signal: AbortSignal | undefined,
  onLine: (data: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
): () => void {
  if (isTauri()) {
    return streamSSEViaTauri(url, body, signal, onLine, onDone, onError);
  }
  return streamSSEViaXHR(url, body, signal, onLine, onDone, onError);
}

/** Call LLM via server proxy — no tools, pure text completion */
export async function callLLM(system: string, userText: string, images?: Array<{ media_type: string; data: string }>, signal?: AbortSignal, onDelta?: (text: string) => void): Promise<{ text: string; meta: LlmMeta; httpStatus: number }> {
  const start = performance.now();
  const content: Array<{ type: string; [key: string]: any }> = [];
  if (images && images.length > 0) {
    for (const img of images) {
      content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } });
    }
  }
  content.push({ type: "text", text: userText });
  const messages: LlmMessage[] = [{ role: "user", content }];
  const body = JSON.stringify({ system, messages, tools: [], max_tokens: 4096 });

  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const result = await streamSSERequest(body, signal, onDelta);
      result.meta.latency_ms = Math.round(performance.now() - start);
      return { text: result.text, meta: result.meta, httpStatus: 200 };
    } catch (err: any) {
      if (err.name === "AbortError") throw err;
      lastError = err;
      const status = err.message?.match(/LLM error: (\d+)/)?.[1];
      const retryable = !status || parseInt(status) >= 500 || parseInt(status) === 429;
      if (attempt < MAX_RETRIES && retryable) {
        await new Promise(r => setTimeout(r, backoffDelay(attempt)));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

/** Call LLM with tools — returns text + tool calls + metadata */
export async function callLLMWithTools(system: string, messages: LlmMessage[], tools: any[], signal?: AbortSignal): Promise<LlmResponse> {
  const start = performance.now();
  const body = JSON.stringify({ system, messages, tools, max_tokens: 4096 });

  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const result = await streamSSERequestFull(body, signal);
      result.meta.latency_ms = Math.round(performance.now() - start);
      return result;
    } catch (err: any) {
      if (err.name === "AbortError") throw err;
      lastError = err;
      const status = err.message?.match(/LLM error: (\d+)/)?.[1];
      const retryable = !status || parseInt(status) >= 500 || parseInt(status) === 429;
      if (attempt < MAX_RETRIES && retryable) {
        await new Promise(r => setTimeout(r, backoffDelay(attempt)));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

/** Stream SSE, return text + meta */
function streamSSERequest(body: string, signal?: AbortSignal, onDelta?: (text: string) => void): Promise<{ text: string; meta: LlmMeta }> {
  return new Promise((resolve, reject) => {
    let text = "";
    const meta: LlmMeta = { tokens_in: 0, tokens_out: 0, latency_ms: 0 };

    streamSSE(
      `${API_BASE}/api/llm/completion`,
      body,
      signal,
      (data) => {
        if (!data || data === "{}") return;
        try {
          const ev = JSON.parse(data);
          if (ev.type === "text_delta") { text += ev.text; if (onDelta) onDelta(ev.text); }
          else if (ev.type === "usage") { meta.tokens_in = ev.input_tokens || 0; meta.tokens_out = ev.output_tokens || 0; }
          else if (ev.type === "error") reject(new Error(ev.message));
        } catch {}
      },
      () => resolve({ text, meta }),
      (err) => reject(err),
    );
  });
}

/** Stream SSE, return text + tool calls + meta */
function streamSSERequestFull(body: string, signal?: AbortSignal): Promise<LlmResponse> {
  return new Promise((resolve, reject) => {
    let text = "";
    const toolCalls: ToolUseBlock[] = [];
    let currentTool: { id: string; name: string; inputJson: string } | null = null;
    let stopReason = "end_turn";
    const meta: LlmMeta = { tokens_in: 0, tokens_out: 0, latency_ms: 0 };

    streamSSE(
      `${API_BASE}/api/llm/completion`,
      body,
      signal,
      (data) => {
        if (!data || data === "{}") return;
        try {
          const ev = JSON.parse(data);
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
            case "usage":
              meta.tokens_in = ev.input_tokens || 0;
              meta.tokens_out = ev.output_tokens || 0;
              break;
            case "error": reject(new Error(ev.message)); break;
          }
        } catch {}
      },
      () => resolve({ text, toolCalls, stopReason, meta }),
      (err) => reject(err),
    );
  });
}

/** Execute a tool — routes to local (Tauri) or server based on environment */
export async function execTool(toolName: string, input: any, workDir: string): Promise<{ content: string; is_error: boolean; duration_ms: number }> {
  const start = performance.now();

  // Tauri environment → local execution
  if (isTauri()) {
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
