<script setup lang="ts">
import { ref, nextTick, onMounted, computed } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useSession, authFetch } from "../composables/useSession";
import { API_BASE } from "../config";
import FolderPicker from "./FolderPicker.vue";

const props = defineProps<{
  sessionId: string;
  workDir?: string;
  title?: string;
}>();

const emit = defineEmits<{
  back: [];
}>();

const { login, token: sessionToken, updateSessionTitle, updateSessionWorkDir } = useSession();

const isEditingTitle = ref(false);
const editTitle = ref("");
const isEditingWorkDir = ref(false);
const editWorkDir = ref("");

interface ToolCall {
  id: string;
  name: string;
  input?: string;
  result?: string;
  isError?: boolean;
  isRunning: boolean;
  expanded: boolean;
}

type Block =
  | { kind: "user"; content: string }
  | { kind: "text"; content: string }
  | { kind: "error"; content: string }
  | { kind: "tool"; tool: ToolCall };

type RenderItem =
  | { kind: "user"; content: string }
  | { kind: "text"; content: string }
  | { kind: "error"; content: string }
  | { kind: "tool"; tool: ToolCall }
  | { kind: "tool-group"; tools: ToolCall[] };

const blocks = ref<Block[]>([]);
const input = ref("");
const isConnected = ref(false);
const isStreaming = ref(false);
const messagesEl = ref<HTMLElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

const isEmpty = computed(() => blocks.value.length === 0 && !isStreaming.value);

const groupExpanded = ref<Record<number, boolean>>({});

const renderItems = computed<RenderItem[]>(() => {
  const items: RenderItem[] = [];
  let i = 0;
  while (i < blocks.value.length) {
    const block = blocks.value[i];
    if (block.kind === "tool") {
      const tools: ToolCall[] = [block.tool];
      let j = i + 1;
      while (j < blocks.value.length && blocks.value[j].kind === "tool") {
        tools.push((blocks.value[j] as { kind: "tool"; tool: ToolCall }).tool);
        j++;
      }
      if (tools.length >= 2) {
        items.push({ kind: "tool-group", tools });
      } else {
        items.push(block);
      }
      i = j;
    } else {
      items.push(block);
      i++;
    }
  }
  return items;
});

function isGroupExpanded(idx: number, tools: ToolCall[]): boolean {
  if (groupExpanded.value[idx] !== undefined) return groupExpanded.value[idx];
  return tools.some((t) => t.isRunning);
}

function toggleGroup(idx: number, tools: ToolCall[]) {
  const current = isGroupExpanded(idx, tools);
  groupExpanded.value[idx] = !current;
}

function groupSummary(tools: ToolCall[]): string {
  const counts: Record<string, number> = {};
  for (const t of tools) {
    counts[t.name] = (counts[t.name] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([name, count]) => `${name} x${count}`)
    .join(", ");
}

const displayDir = computed(() => {
  return props.workDir || "";
});

function toggleToolCall(tc: ToolCall) {
  tc.expanded = !tc.expanded;
}

function previewLines(text: string): string {
  return text.split("\n").slice(0, 3).join("\n");
}

function toolSummary(tc: ToolCall): string {
  if (!tc.input) return "";
  try {
    const parsed = JSON.parse(tc.input);
    if (parsed.command) return parsed.command;
    return tc.input;
  } catch {
    return tc.input;
  }
}

function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(raw);
}

async function connect() {
  await login();
  isConnected.value = !!sessionToken.value;
}

async function loadHistory() {
  try {
    const res = await authFetch(`/api/sessions/${props.sessionId}/messages`);
    if (!res.ok) return;
    const messages = await res.json();
    for (const msg of messages) {
      try {
        const content = JSON.parse(msg.content);
        if (msg.role === "user") {
          for (const block of content) {
            if (block.type === "tool_result") {
              for (let i = blocks.value.length - 1; i >= 0; i--) {
                const b = blocks.value[i];
                if (b.kind === "tool" && b.tool.id === block.tool_use_id) {
                  b.tool.result = block.content;
                  b.tool.isError = block.is_error;
                  b.tool.isRunning = false;
                  break;
                }
              }
            } else if (block.text) {
              blocks.value.push({ kind: "user", content: block.text });
            }
          }
        } else {
          for (const block of content) {
            if (block.type === "text" && block.text) {
              blocks.value.push({ kind: "text", content: block.text });
            } else if (block.type === "error" && block.text) {
              blocks.value.push({ kind: "error", content: block.text });
            } else if (block.type === "tool_use") {
              blocks.value.push({
                kind: "tool",
                tool: {
                  id: block.id,
                  name: block.name,
                  input: typeof block.input === "string" ? block.input : JSON.stringify(block.input),
                  isRunning: false,
                  expanded: false,
                },
              });
            }
          }
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* offline */ }
}

function handleServerEvent(event: any) {
  switch (event.type) {
    case "text_delta": {
      const last = blocks.value[blocks.value.length - 1];
      if (last && last.kind === "text") {
        last.content += event.text;
      } else {
        blocks.value.push({ kind: "text", content: event.text });
      }
      break;
    }
    case "tool_start": {
      blocks.value.push({
        kind: "tool",
        tool: {
          id: event.id,
          name: event.name,
          input: event.input,
          isRunning: true,
          expanded: false,
        },
      });
      break;
    }
    case "tool_result": {
      for (let i = blocks.value.length - 1; i >= 0; i--) {
        const b = blocks.value[i];
        if (b.kind === "tool" && b.tool.id === event.id) {
          b.tool.result = event.content;
          b.tool.isError = event.is_error;
          b.tool.isRunning = false;
          break;
        }
      }
      break;
    }
    case "turn_complete":
      isStreaming.value = false;
      break;
    case "error":
      blocks.value.push({ kind: "error", content: event.message });
      isStreaming.value = false;
      break;
  }

  nextTick(() => {
    messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight, behavior: "smooth" });
  });
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    send();
  }
  // Ctrl+J inserts newline (Shift+Enter is default textarea behavior)
  if (e.key === "j" && e.ctrlKey) {
    e.preventDefault();
    const ta = textareaRef.value;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    input.value = input.value.substring(0, start) + "\n" + input.value.substring(end);
    nextTick(() => {
      ta.selectionStart = ta.selectionEnd = start + 1;
      autoResize();
    });
  }
}

function autoResize() {
  const ta = textareaRef.value;
  if (!ta) return;
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
}

function startEditTitle() {
  editTitle.value = props.title || "";
  isEditingTitle.value = true;
}

function cancelEditTitle() {
  isEditingTitle.value = false;
}

async function confirmEditTitle() {
  const newTitle = editTitle.value.trim();
  isEditingTitle.value = false;
  if (newTitle !== (props.title || "")) {
    await updateSessionTitle(props.sessionId, newTitle);
  }
}

function startEditWorkDir() {
  editWorkDir.value = props.workDir || "";
  isEditingWorkDir.value = true;
}

function cancelEditWorkDir() {
  isEditingWorkDir.value = false;
}

async function confirmEditWorkDir() {
  const newDir = editWorkDir.value.trim() || null;
  isEditingWorkDir.value = false;
  if (newDir !== (props.workDir || null)) {
    await updateSessionWorkDir(props.sessionId, newDir);
  }
}

async function send() {
  if (!input.value.trim() || !isConnected.value || isStreaming.value) return;

  const content = input.value.trim();
  blocks.value.push({ kind: "user", content });
  input.value = "";
  nextTick(() => {
    if (textareaRef.value) textareaRef.value.style.height = "auto";
    messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight });
  });
  isStreaming.value = true;

  try {
    const res = await authFetch(
      `/api/sessions/${props.sessionId}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      }
    );

    if (!res.ok) {
      blocks.value.push({ kind: "error", content: `Request failed: ${res.status}` });
      isStreaming.value = false;
      return;
    }

    const reader = res.body!.getReader();
    activeReader = reader;
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const json = line.slice(6);
          if (json) {
            try { handleServerEvent(JSON.parse(json)); } catch { /* malformed SSE */ }
          }
        }
      }
    }

    if (buffer.startsWith("data: ")) {
      const json = buffer.slice(6);
      if (json) {
        try { handleServerEvent(JSON.parse(json)); } catch { /* malformed SSE */ }
      }
    }
  } catch (e: any) {
    if (e.name === "AbortError") return;
    blocks.value.push({ kind: "error", content: `Connection lost: ${e.message || e}` });
    isStreaming.value = false;
  } finally {
    activeReader = null;
  }
}

async function stop() {
  // Cancel client-side reader
  if (activeReader) {
    try { await activeReader.cancel(); } catch { /* ignore */ }
    activeReader = null;
  }
  // Tell server to cancel
  try {
    await authFetch(`/api/sessions/${props.sessionId}/stop`, { method: "POST" });
  } catch { /* best effort */ }
  isStreaming.value = false;
}

async function resend() {
  // Find the last user block before the error
  let lastUserIdx = -1;
  for (let i = blocks.value.length - 1; i >= 0; i--) {
    if (blocks.value[i].kind === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return;

  const userBlock = blocks.value[lastUserIdx] as { kind: "user"; content: string };
  const content = userBlock.content;

  // Count how many user blocks exist before this one (to compute keep_count for DB)
  // Each user message in DB corresponds to blocks before lastUserIdx
  // We need to count messages in DB to keep: all messages before the failed one
  const messagesBeforeError = blocks.value.slice(0, lastUserIdx);
  // Count user blocks = user messages in DB, count text/tool sequences = assistant messages
  let keepCount = 0;
  let i = 0;
  while (i < messagesBeforeError.length) {
    const b = messagesBeforeError[i];
    if (b.kind === "user") {
      keepCount++;
      i++;
    } else {
      // assistant turn: text + tools until next user
      keepCount++;
      i++;
      while (i < messagesBeforeError.length && messagesBeforeError[i].kind !== "user") {
        i++;
      }
    }
  }

  // Truncate DB messages
  try {
    await authFetch(`/api/sessions/${props.sessionId}/messages/truncate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keep_count: keepCount }),
    });
  } catch { /* best effort */ }

  // Remove the failed user message and everything after it from UI
  blocks.value.splice(lastUserIdx);

  // Re-send
  blocks.value.push({ kind: "user", content });
  isStreaming.value = true;

  try {
    const res = await authFetch(
      `/api/sessions/${props.sessionId}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      }
    );

    if (!res.ok) {
      blocks.value.push({ kind: "error", content: `Request failed: ${res.status}` });
      isStreaming.value = false;
      return;
    }

    const reader = res.body!.getReader();
    activeReader = reader;
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const json = line.slice(6);
          if (json) {
            try { handleServerEvent(JSON.parse(json)); } catch { /* malformed SSE */ }
          }
        }
      }
    }

    if (buffer.startsWith("data: ")) {
      const json = buffer.slice(6);
      if (json) {
        try { handleServerEvent(JSON.parse(json)); } catch { /* malformed SSE */ }
      }
    }
  } catch (e: any) {
    if (e.name === "AbortError") return;
    blocks.value.push({ kind: "error", content: `Connection lost: ${e.message || e}` });
    isStreaming.value = false;
  } finally {
    activeReader = null;
  }
}

onMounted(async () => {
  await connect();
  await loadHistory();
  nextTick(() => {
    messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight });
  });
});
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="context-bar">
      <button class="back-btn" @click="emit('back')" aria-label="Back to sessions">&larr;</button>
      <template v-if="isEditingTitle">
        <input
          v-model="editTitle"
          class="title-input"
          @keydown.enter="confirmEditTitle"
          @keydown.escape="cancelEditTitle"
          autofocus
        />
        <button class="title-action-btn confirm" @click="confirmEditTitle" aria-label="Confirm title">&#10003;</button>
        <button class="title-action-btn cancel" @click="cancelEditTitle" aria-label="Cancel edit">&#10005;</button>
      </template>
      <span v-else class="context-title" @click="startEditTitle">{{ title || 'Untitled' }}</span>
      <template v-if="isEditingWorkDir">
        <div class="workdir-edit">
          <FolderPicker v-model="editWorkDir" />
          <button class="title-action-btn confirm" @click="confirmEditWorkDir" aria-label="Confirm work dir">&#10003;</button>
          <button class="title-action-btn cancel" @click="cancelEditWorkDir" aria-label="Cancel edit">&#10005;</button>
        </div>
      </template>
      <span v-else-if="displayDir && !isEditingTitle" class="context-dir" @click="startEditWorkDir">{{ displayDir }}</span>
    </div>

    <div v-if="!isEmpty" ref="messagesEl" class="flex-1 overflow-y-auto">
      <div class="max-w-[720px] mx-auto px-6 py-8 space-y-6">
        <template v-for="(item, idx) in renderItems" :key="idx">
          <div v-if="item.kind === 'user'" class="user-block">
            <pre class="whitespace-pre-wrap text-[15px] leading-relaxed font-medium" style="color: var(--color-text-primary)">{{ item.content }}</pre>
          </div>
          <div v-else-if="item.kind === 'text'" class="agent-block">
            <div class="markdown-body" v-html="renderMarkdown(item.content)"></div>
          </div>
          <div v-else-if="item.kind === 'error'" class="error-block">
            <span class="error-message">{{ item.content }}</span>
            <button class="retry-btn" @click="resend" :disabled="isStreaming">Retry</button>
          </div>
          <div v-else-if="item.kind === 'tool'" class="tool-block">
            <button @click="toggleToolCall(item.tool)" class="tool-header" :class="{ 'tool-running': item.tool.isRunning, 'tool-error': item.tool.isError && !item.tool.isRunning }">
              <span class="tool-indicator" :class="{ active: item.tool.isRunning }"></span>
              <span class="tool-name">{{ item.tool.name }}</span>
              <span class="tool-summary">{{ toolSummary(item.tool) }}</span>
            </button>
            <div v-if="!item.tool.expanded && item.tool.result" class="tool-preview" @click="toggleToolCall(item.tool)">
              <pre class="tool-content" :class="{ 'tool-content-error': item.tool.isError }">{{ previewLines(item.tool.result) }}</pre>
            </div>
            <div v-if="item.tool.expanded && (item.tool.input || item.tool.result)" class="tool-body">
              <pre v-if="item.tool.input" class="tool-content">{{ item.tool.input }}</pre>
              <pre v-if="item.tool.result" class="tool-content" :class="{ 'tool-content-error': item.tool.isError }">{{ item.tool.result }}</pre>
            </div>
          </div>
          <div v-else-if="item.kind === 'tool-group'" class="tool-group-block">
            <button @click="toggleGroup(idx, item.tools)" class="tool-group-header">
              <span class="tool-indicator" :class="{ active: item.tools.some(t => t.isRunning) }"></span>
              <span class="tool-group-summary">{{ groupSummary(item.tools) }}</span>
              <span class="tool-group-meta">({{ item.tools.length }} tool uses)</span>
              <span class="tool-group-chevron" :class="{ open: isGroupExpanded(idx, item.tools) }">&#9656;</span>
            </button>
            <div v-if="isGroupExpanded(idx, item.tools)" class="tool-group-body">
              <div v-for="(tc, ti) in item.tools" :key="ti" class="tool-block">
                <button @click="toggleToolCall(tc)" class="tool-header" :class="{ 'tool-running': tc.isRunning, 'tool-error': tc.isError && !tc.isRunning }">
                  <span class="tool-indicator" :class="{ active: tc.isRunning }"></span>
                  <span class="tool-name">{{ tc.name }}</span>
                  <span class="tool-summary">{{ toolSummary(tc) }}</span>
                </button>
                <div v-if="!tc.expanded && tc.result" class="tool-preview" @click="toggleToolCall(tc)">
                  <pre class="tool-content" :class="{ 'tool-content-error': tc.isError }">{{ previewLines(tc.result) }}</pre>
                </div>
                <div v-if="tc.expanded && (tc.input || tc.result)" class="tool-body">
                  <pre v-if="tc.input" class="tool-content">{{ tc.input }}</pre>
                  <pre v-if="tc.result" class="tool-content" :class="{ 'tool-content-error': tc.isError }">{{ tc.result }}</pre>
                </div>
              </div>
            </div>
          </div>
        </template>
        <div v-if="isStreaming && blocks.length === 0" class="streaming-dot"></div>
        <div class="scroll-spacer"></div>
      </div>
    </div>

    <div v-else class="flex-1"></div>

    <div class="input-area" :class="isEmpty ? 'input-centered' : 'input-docked'">
      <div class="max-w-[720px] mx-auto w-full px-6">
        <div class="input-wrapper">
          <textarea
            ref="textareaRef"
            v-model="input"
            @keydown="handleKeydown"
            @input="autoResize"
            :disabled="!isConnected"
            :placeholder="!isConnected ? 'Offline' : ''"
            class="input-field"
            rows="1"
            aria-label="Message input"
          ></textarea>
          <button
            class="send-btn"
            :class="{ 'stop-mode': isStreaming }"
            @click="isStreaming ? stop() : send()"
            :disabled="!isConnected || (!isStreaming && !input.trim())"
            :aria-label="isStreaming ? 'Stop generation' : 'Send message'"
          >
            <svg v-if="!isStreaming" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 14V3M8 3L3 8M8 3L13 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <svg v-else width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="12" height="12" rx="2" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.context-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border-subtle);
  min-height: 40px;
}
.back-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: color 0.12s;
}
.back-btn:hover { color: var(--color-text-primary); }
.context-dir {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 0.12s;
}
.context-dir:hover { background: var(--color-surface-1); }
.workdir-edit {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}
.context-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 0.12s;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
}
.context-title:hover { background: var(--color-surface-1); }
.title-input {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 2px 8px;
  outline: none;
  min-width: 120px;
  max-width: 300px;
}
.title-input:focus { border-color: var(--color-accent-dim); }
.title-action-btn {
  background: none;
  border: none;
  font-size: 14px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: color 0.12s;
}
.title-action-btn.confirm { color: var(--color-success, #22c55e); }
.title-action-btn.cancel { color: var(--color-error, #ef4444); }
.title-action-btn:hover { opacity: 0.7; }
.user-block {
  padding-top: 8px;
  padding-bottom: 4px;
  border-top: 1px solid var(--color-border);
}
.agent-block { padding: 4px 0; }
.markdown-body {
  font-size: 14px;
  line-height: 1.7;
  color: var(--color-text-secondary);
}
.markdown-body :deep(h1), .markdown-body :deep(h2), .markdown-body :deep(h3), .markdown-body :deep(h4) {
  color: var(--color-text-primary);
  font-weight: 600;
  margin: 1em 0 0.5em;
}
.markdown-body :deep(h1) { font-size: 1.4em; }
.markdown-body :deep(h2) { font-size: 1.2em; }
.markdown-body :deep(h3) { font-size: 1.05em; }
.markdown-body :deep(p) { margin: 0.5em 0; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { padding-left: 1.5em; margin: 0.5em 0; }
.markdown-body :deep(li) { margin: 0.25em 0; }
.markdown-body :deep(strong) { color: var(--color-text-primary); font-weight: 600; }
.markdown-body :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--color-surface-2, rgba(255, 255, 255, 0.06));
  padding: 0.15em 0.4em;
  border-radius: 3px;
}
.markdown-body :deep(pre) {
  background: var(--color-surface-2, rgba(255, 255, 255, 0.06));
  padding: 12px 16px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0.75em 0;
}
.markdown-body :deep(pre code) { background: none; padding: 0; font-size: 12px; line-height: 1.5; }
.markdown-body :deep(hr) { border: none; border-top: 1px solid var(--color-border); margin: 1.5em 0; }
.markdown-body :deep(a) { color: var(--color-accent, #3b82f6); text-decoration: none; }
.markdown-body :deep(a:hover) { text-decoration: underline; }
.tool-block { margin: 4px 0; }
.tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 0;
  text-align: left;
  cursor: pointer;
  border: none;
  background: none;
  transition: opacity 0.15s ease-out;
}
.tool-header:hover { opacity: 0.8; }
.tool-indicator { width: 6px; height: 6px; border-radius: 50%; background: var(--color-success); flex-shrink: 0; }
.tool-indicator.active { background: var(--color-accent); animation: pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
.tool-error .tool-indicator { background: var(--color-error); }
.tool-name { font-family: var(--font-mono); font-size: 12px; color: var(--color-text-muted); flex-shrink: 0; }
.tool-summary { font-family: var(--font-mono); font-size: 12px; color: var(--color-text-muted); opacity: 0.6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-body { padding: 8px 0 8px 14px; border-left: 1px solid var(--color-border-subtle); margin-left: 2px; }
.tool-preview { padding: 4px 0 4px 14px; border-left: 1px solid var(--color-border-subtle); margin-left: 2px; cursor: pointer; }
.tool-content { font-family: var(--font-mono); font-size: 11px; line-height: 1.6; color: var(--color-text-muted); white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; margin: 4px 0; }
.tool-content-error { color: var(--color-error); }
.tool-group-block { margin: 4px 0; }
.tool-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 0;
  text-align: left;
  cursor: pointer;
  border: none;
  background: none;
  transition: opacity 0.15s ease-out;
}
.tool-group-header:hover { opacity: 0.8; }
.tool-group-summary { font-family: var(--font-mono); font-size: 12px; color: var(--color-text-muted); }
.tool-group-meta { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-muted); opacity: 0.5; }
.tool-group-chevron { font-size: 10px; color: var(--color-text-muted); opacity: 0.6; transition: transform 0.15s ease-out; display: inline-block; }
.tool-group-chevron.open { transform: rotate(90deg); }
.tool-group-body { padding: 4px 0 4px 14px; border-left: 1px solid var(--color-border-subtle); margin-left: 2px; }
.error-block {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: color-mix(in srgb, var(--color-error, #ef4444) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-error, #ef4444) 25%, transparent);
  border-radius: 6px;
  margin: 4px 0;
}
.error-message {
  font-size: 13px;
  color: var(--color-error, #ef4444);
  flex: 1;
}
.retry-btn {
  flex-shrink: 0;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.retry-btn:hover:not(:disabled) { background: var(--color-surface-2, rgba(255,255,255,0.06)); border-color: var(--color-text-muted); }
.retry-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.input-area { padding: 24px 0 32px; }
.input-centered { display: flex; align-items: center; justify-content: center; }
.input-docked { border-top: 1px solid var(--color-border-subtle); }
.input-wrapper { position: relative; display: flex; align-items: flex-end; }
.input-field {
  width: 100%;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 14px 48px 14px 18px;
  font-size: 15px;
  color: var(--color-text-primary);
  outline: none;
  transition: border-color 0.2s ease-out, box-shadow 0.2s ease-out;
  resize: none;
  overflow-y: auto;
  line-height: 1.5;
  font-family: inherit;
}
.input-field:focus { border-color: var(--color-accent-dim); box-shadow: 0 0 0 3px oklch(0.72 0.14 55 / 0.08); }
.input-field:disabled { opacity: 0.4; cursor: not-allowed; }
.input-field::placeholder { color: var(--color-text-muted); }
.send-btn {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: var(--color-text-primary);
  color: var(--color-surface-0, #1a1a1a);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s;
}
.send-btn:hover:not(:disabled) { opacity: 0.85; }
.send-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.send-btn.stop-mode { background: var(--color-error, #ef4444); color: #fff; }
.streaming-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-accent); animation: pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
.scroll-spacer { min-height: 60vh; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>