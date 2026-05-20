import type { LlmMessage, LlmResponse, LlmMeta, ToolUseBlock } from "./types";
import { authFetch } from "../../composables/useSession";
import { execToolLocal } from "./localTools";
import { API_BASE } from "../../config";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const SSE_READ_TIMEOUT_MS = 120_000; // 120s 无数据则判定连接挂起

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
 * Stream SSE via Tauri invoke + Channel.
 * Channel delivers events directly from the command without global event bus.
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
  let finished = false;

  // Read timeout for Tauri path
  let readTimer: ReturnType<typeof setTimeout> | null = null;
  const resetReadTimer = () => {
    if (readTimer) clearTimeout(readTimer);
    if (finished || aborted) return;
    readTimer = setTimeout(() => {
      if (!finished && !aborted) { finished = true; aborted = true; onError(new Error("SSE read timeout: no data received for 120s")); }
    }, SSE_READ_TIMEOUT_MS);
  };

  const run = async () => {
    try {
      const { invoke, Channel } = await import("@tauri-apps/api/core");

      if (signal?.aborted) { onError(new DOMException("Aborted", "AbortError")); return; }

      resetReadTimer();
      const onEvent = new Channel<{ data: string; done: boolean }>();
      onEvent.onmessage = (event) => {
        if (aborted) return;
        resetReadTimer();
        if (event.done) {
          finished = true;
          if (readTimer) clearTimeout(readTimer);
          onDone();
        } else if (event.data) {
          onLine(event.data);
        }
      };

      await invoke("llm_stream", {
        req: { url, token: getToken(), body },
        onEvent,
      });
      // invoke resolves after stream ends; if onDone wasn't called via channel, call it now
      // (Channel should have delivered done:true before invoke resolves)
    } catch (err: any) {
      finished = true;
      if (readTimer) clearTimeout(readTimer);
      if (!aborted) {
        onError(new Error(err?.toString() || "Tauri invoke failed"));
      }
    }
  };

  run();

  if (signal) {
    signal.addEventListener("abort", () => { aborted = true; if (readTimer) clearTimeout(readTimer); });
  }

  return () => { aborted = true; };
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
  let finished = false;

  // Read timeout: abort if no data received within threshold
  let readTimer: ReturnType<typeof setTimeout> | null = null;
  const resetReadTimer = () => {
    if (readTimer) clearTimeout(readTimer);
    if (finished) return;
    readTimer = setTimeout(() => {
      if (!finished) { finished = true; xhr.abort(); onError(new Error("SSE read timeout: no data received for 120s")); }
    }, SSE_READ_TIMEOUT_MS);
  };
  resetReadTimer();

  xhr.onprogress = () => {
    resetReadTimer();
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
    finished = true;
    if (readTimer) clearTimeout(readTimer);
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

  xhr.onerror = () => { finished = true; if (readTimer) clearTimeout(readTimer); onError(new Error("Network error")); };
  xhr.onabort = () => { if (!finished) { finished = true; if (readTimer) clearTimeout(readTimer); onError(new DOMException("Aborted", "AbortError")); } };
  xhr.ontimeout = () => { finished = true; if (readTimer) clearTimeout(readTimer); onError(new Error("Request timeout")); };

  if (signal) {
    if (signal.aborted) { xhr.abort(); return () => {}; }
    signal.addEventListener("abort", () => xhr.abort());
  }

  xhr.send(body);
  return () => { finished = true; if (readTimer) clearTimeout(readTimer); xhr.abort(); };
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
    let resolved = false;
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
          else if (ev.type === "message_end") {
            if (!resolved) { resolved = true; resolve({ text, meta }); }
          }
          else if (ev.type === "error") {
            if (!resolved) { resolved = true; reject(new Error(ev.message)); }
          }
        } catch {}
      },
      () => { if (!resolved) { resolved = true; resolve({ text, meta }); } },
      (err) => { if (!resolved) { resolved = true; reject(err); } },
    );
  });
}

/** Stream SSE, return text + tool calls + meta */
function streamSSERequestFull(body: string, signal?: AbortSignal): Promise<LlmResponse> {
  return new Promise((resolve, reject) => {
    let text = "";
    let resolved = false;
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
                try { input = JSON.parse(currentTool.inputJson); } catch (e) { console.warn("[LLM] Failed to parse tool input JSON:", currentTool.inputJson, e); }
                console.log("[LLM] tool_use_end:", currentTool.name, "parsed input type=", typeof input, "isArray=", Array.isArray(input));
                toolCalls.push({ type: "tool_use", id: currentTool.id, name: currentTool.name, input });
                currentTool = null;
              }
              break;
            case "message_end":
              stopReason = ev.stop_reason || "end_turn";
              // Resolve immediately — don't wait for TCP close
              if (!resolved) { resolved = true; resolve({ text, toolCalls, stopReason, meta }); }
              break;
            case "usage":
              meta.tokens_in = ev.input_tokens || 0;
              meta.tokens_out = ev.output_tokens || 0;
              break;
            case "error":
              if (!resolved) { resolved = true; reject(new Error(ev.message)); }
              break;
          }
        } catch {}
      },
      () => { if (!resolved) { resolved = true; resolve({ text, toolCalls, stopReason, meta }); } },
      (err) => { if (!resolved) { resolved = true; reject(err); } },
    );
  });
}

/** Allowlist of read-only command prefixes for the bash tool in reader context */
const BASH_ALLOWLIST = [
  "curl", "cat", "head", "tail", "ls", "find", "wc", "file", "stat",
  "echo", "grep", "rg", "ag", "tree", "du", "df", "which", "type",
  "git log", "git show", "git diff", "git status", "git branch",
];

/** Validate bash command against allowlist. Returns error message or null if allowed. */
export function validateBashCommand(command: string): string | null {
  const trimmed = command.trim();
  // Block empty commands
  if (!trimmed) return "Empty command";
  // Block subshell injection in ALL commands (including curl)
  if (/[`]|\$\(/.test(trimmed)) return "Subshell execution ($() and backticks) is not allowed.";
  // Block semicolons and && that chain commands
  if (/[;&]/.test(trimmed)) {
    return "Command chaining (;, &) is not allowed. Use a single command.";
  }
  // Allow pipes only if every segment starts with an allowed command
  const segments = trimmed.split(/\s*\|\s*/);
  for (const seg of segments) {
    const s = seg.trim();
    if (!s) return "Empty pipe segment";
    const isAllowed = BASH_ALLOWLIST.some(prefix => s.startsWith(prefix));
    if (!isAllowed) return `Command not allowed: ${s.split(" ")[0]}. Only read-only commands (curl, cat, ls, etc.) are permitted.`;
  }
  return null;
}

/** Execute a tool — routes to local (Tauri) or server based on environment */
export async function execTool(toolName: string, input: any, workDir: string): Promise<{ content: string; is_error: boolean; duration_ms: number }> {
  const start = performance.now();

  // Bash command allowlist enforcement
  if (toolName === "bash") {
    const error = validateBashCommand(input?.command || "");
    if (error) {
      return { content: error, is_error: true, duration_ms: Math.round(performance.now() - start) };
    }
  }

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
