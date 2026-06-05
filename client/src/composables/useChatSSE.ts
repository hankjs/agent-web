import { ref, nextTick, type Ref } from "vue";
import { ChatBlockKind, type Block } from "../types/chat";
import { authFetch } from "./useSession";

export interface UseChatSSEOptions {
  blocks: Ref<Block[]>;
  sessionId: Ref<string>;
  isStreaming: Ref<boolean>;
  messagesEl: Ref<HTMLElement | null>;
  collapseFinishedToolGroups: () => void;
  onTurnComplete?: () => void;
  onChangeEvent?: () => void;
}

export function useChatSSE(options: UseChatSSEOptions) {
  const { blocks, sessionId, isStreaming, messagesEl, collapseFinishedToolGroups, onTurnComplete, onChangeEvent } = options;

  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let lastEventId = "";
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 3;
  const RECONNECT_DELAYS = [1000, 3000, 5000];
  const HEARTBEAT_TIMEOUT = 20000;
  let currentSessionStreaming = false;

  function handleServerEvent(event: any) {
    switch (event.type) {
      case "text_delta": {
        const last = blocks.value[blocks.value.length - 1];
        if (last && last.kind === ChatBlockKind.Text) {
          last.content += event.text;
        } else {
          collapseFinishedToolGroups();
          blocks.value.push({ kind: ChatBlockKind.Text, content: event.text });
        }
        break;
      }
      case "tool_start": {
        blocks.value.push({
          kind: ChatBlockKind.Tool,
          tool: { id: event.id, name: event.name, input: event.input, isRunning: true, expanded: false },
        });
        break;
      }
      case "tool_result": {
        for (let i = blocks.value.length - 1; i >= 0; i--) {
          const b = blocks.value[i];
          if (b.kind === ChatBlockKind.Tool && b.tool.id === event.id) {
            b.tool.result = event.content;
            b.tool.isError = event.is_error;
            b.tool.isRunning = false;
            b.tool.streamingOutput = undefined;
            break;
          }
        }
        break;
      }
      case "turn_complete":
        isStreaming.value = false;
        currentSessionStreaming = false;
        clearHeartbeatTimer();
        reconnectAttempts = 0;
        onTurnComplete?.();
        break;
      case "error":
        blocks.value.push({ kind: ChatBlockKind.Error, content: event.message });
        isStreaming.value = false;
        currentSessionStreaming = false;
        clearHeartbeatTimer();
        break;
      case "ask_user":
        blocks.value.push({
          kind: ChatBlockKind.AskUser,
          toolUseId: event.tool_use_id || "",
          questions: [{ header: "", question: event.question, options: event.options || [], selected: undefined, customMode: false, customAnswer: "" }],
          answered: false,
          activeTab: 0,
        });
        break;
      case "explore_complete":
      case "generate_complete":
      case "task_updated":
        onChangeEvent?.();
        break;
      case "tool_output_delta": {
        for (let i = blocks.value.length - 1; i >= 0; i--) {
          const b = blocks.value[i];
          if (b.kind === ChatBlockKind.Tool && b.tool.id === event.id) {
            b.tool.streamingOutput = (b.tool.streamingOutput || "") + event.chunk;
            break;
          }
        }
        break;
      }
      case "file_changed":
        if (event.changes?.length) {
          blocks.value.push({ kind: ChatBlockKind.FileChanged, changes: event.changes });
        }
        break;
      case "permission_requested":
        blocks.value.push({
          kind: ChatBlockKind.PermissionRequest,
          runId: event.run_id, turnId: event.turn_id,
          tool: event.tool, toolUseId: event.tool_use_id,
          risk: event.risk, reason: event.reason, answered: false,
        });
        break;
      case "permission_denied":
        // Mark last matching permission_requested as answered
        for (let i = blocks.value.length - 1; i >= 0; i--) {
          const b = blocks.value[i];
          if (b.kind === ChatBlockKind.PermissionRequest && b.toolUseId === event.tool_use_id) {
            b.answered = true;
            break;
          }
        }
        break;
      case "verification_started":
        blocks.value.push({ kind: ChatBlockKind.Verification, status: "started" });
        break;
      case "verification_completed":
        // Update the last verification_started block or push a completed one
        for (let i = blocks.value.length - 1; i >= 0; i--) {
          const b = blocks.value[i];
          if (b.kind === ChatBlockKind.Verification && b.status === "started") {
            b.status = "completed";
            b.verdict = event.verdict;
            b.issues = event.issues;
            break;
          }
        }
        break;
      case "run_started":
        blocks.value.push({ kind: ChatBlockKind.RunStatus, status: "started" });
        break;
      case "run_completed":
        blocks.value.push({ kind: ChatBlockKind.RunStatus, status: "completed" });
        break;
      case "run_failed":
        blocks.value.push({ kind: ChatBlockKind.RunStatus, status: "failed", message: event.message });
        break;
      case "run_cancelled":
        blocks.value.push({ kind: ChatBlockKind.RunStatus, status: "cancelled" });
        break;
    }

    nextTick(() => {
      if (!messagesEl.value) return;
      const spacer = messagesEl.value.querySelector('.scroll-spacer') as HTMLElement | null;
      if (spacer) {
        const target = spacer.offsetTop - messagesEl.value.clientHeight;
        if (target > messagesEl.value.scrollTop) {
          messagesEl.value.scrollTo({ top: target, behavior: "smooth" });
        }
      }
    });
  }

  function resetHeartbeatTimer() {
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    if (!currentSessionStreaming) return;
    heartbeatTimer = setTimeout(() => { handleDisconnect(); }, HEARTBEAT_TIMEOUT);
  }

  function clearHeartbeatTimer() {
    if (heartbeatTimer) { clearTimeout(heartbeatTimer); heartbeatTimer = null; }
  }

  async function handleDisconnect() {
    clearHeartbeatTimer();
    if (activeReader) {
      try { await activeReader.cancel(); } catch { /* ignore */ }
      activeReader = null;
    }
    if (!currentSessionStreaming) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      blocks.value.push({ kind: ChatBlockKind.Error, content: "连接断开，多次重连失败。" });
      isStreaming.value = false;
      currentSessionStreaming = false;
      reconnectAttempts = 0;
      return;
    }
    const delay = RECONNECT_DELAYS[reconnectAttempts] || 5000;
    reconnectAttempts++;
    await new Promise((r) => setTimeout(r, delay));
    if (!currentSessionStreaming) return;
    try { await resumeStream(); } catch { handleDisconnect(); }
  }

  async function resumeStream() {
    const res = await authFetch(`/api/sessions/${sessionId.value}/events/resume?last_event_id=${lastEventId}`);
    if (!res.ok) throw new Error(`Resume failed: ${res.status}`);
    const reader = res.body!.getReader();
    activeReader = reader;
    resetHeartbeatTimer();
    await readSSEStream(reader);
  }

  async function readSSEStream(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const decoder = new TextDecoder();
    let buffer = "";
    let currentId = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) {
          if (line.startsWith("id: ") || line.startsWith("id:")) {
            currentId = line.slice(line.indexOf(":") + 1).trim();
          } else if (line.startsWith("event: ")) {
            const eventType = line.slice(7).trim();
            if (eventType === "heartbeat") { resetHeartbeatTimer(); currentId = ""; }
          } else if (line.startsWith("data: ")) {
            const json = line.slice(6);
            if (json && json !== "{}") {
              try {
                handleServerEvent(JSON.parse(json));
                if (currentId) { lastEventId = currentId; reconnectAttempts = 0; }
              } catch { /* malformed SSE */ }
            }
            resetHeartbeatTimer();
            currentId = "";
          }
        }
      }
      if (buffer) {
        const lines = buffer.split("\n");
        for (const line of lines) {
          if (line.startsWith("id: ") || line.startsWith("id:")) {
            currentId = line.slice(line.indexOf(":") + 1).trim();
          } else if (line.startsWith("data: ")) {
            const json = line.slice(6);
            if (json && json !== "{}") {
              try { handleServerEvent(JSON.parse(json)); if (currentId) lastEventId = currentId; } catch { /* malformed */ }
            }
          }
        }
      }
    } catch (e: any) {
      if (e.name === "AbortError") return;
      if (currentSessionStreaming) { handleDisconnect(); }
    } finally {
      activeReader = null;
    }
  }

  async function startStream(body: any) {
    currentSessionStreaming = true;
    lastEventId = "";
    reconnectAttempts = 0;
    try {
      const res = await authFetch(`/api/sessions/${sessionId.value}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        blocks.value.push({ kind: ChatBlockKind.Error, content: `Request failed: ${res.status}` });
        isStreaming.value = false;
        currentSessionStreaming = false;
        return;
      }
      const reader = res.body!.getReader();
      activeReader = reader;
      resetHeartbeatTimer();
      await readSSEStream(reader);
    } catch (e: any) {
      if (e.name === "AbortError") return;
      if (currentSessionStreaming) { handleDisconnect(); }
      else {
        blocks.value.push({ kind: ChatBlockKind.Error, content: `Connection lost: ${e.message || e}` });
        isStreaming.value = false;
      }
    }
  }

  async function stopStream() {
    currentSessionStreaming = false;
    clearHeartbeatTimer();
    reconnectAttempts = 0;
    if (activeReader) {
      try { await activeReader.cancel(); } catch { /* ignore */ }
      activeReader = null;
    }
    try { await authFetch(`/api/sessions/${sessionId.value}/stop`, { method: "POST" }); } catch { /* best effort */ }
  }

  function resetState() {
    lastEventId = "";
    reconnectAttempts = 0;
    currentSessionStreaming = false;
    clearHeartbeatTimer();
  }

  return {
    startStream,
    stopStream,
    resetState,
    handleServerEvent,
  };
}
