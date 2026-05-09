<script setup lang="ts">
import { ref, nextTick, onMounted, computed } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useSession, authFetch } from "../composables/useSession";
import { API_BASE } from "../config";

const props = defineProps<{
  sessionId: string;
  workDir?: string;
}>();

const emit = defineEmits<{
  back: [];
}>();

const { login, token: sessionToken } = useSession();

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
  | { kind: "tool"; tool: ToolCall };

const blocks = ref<Block[]>([]);
const input = ref("");
const isConnected = ref(false);
const isStreaming = ref(false);
const messagesEl = ref<HTMLElement | null>(null);

const isEmpty = computed(() => blocks.value.length === 0 && !isStreaming.value);

const displayDir = computed(() => {
  if (!props.workDir) return "";
  const parts = props.workDir.split("/");
  return parts[parts.length - 1] || props.workDir;
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
      blocks.value.push({ kind: "text", content: `Error: ${event.message}` });
      isStreaming.value = false;
      break;
  }

  nextTick(() => {
    messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight, behavior: "smooth" });
  });
}

async function send() {
  if (!input.value.trim() || !isConnected.value || isStreaming.value) return;

  const content = input.value.trim();
  blocks.value.push({ kind: "user", content });
  input.value = "";
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
      blocks.value.push({ kind: "text", content: `Request failed: ${res.status}` });
      isStreaming.value = false;
      return;
    }

    const reader = res.body!.getReader();
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
    blocks.value.push({ kind: "text", content: `Connection lost: ${e.message || e}` });
    isStreaming.value = false;
  }
}

onMounted(async () => {
  await connect();
  await loadHistory();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="context-bar">
      <button class="back-btn" @click="emit('back')" aria-label="Back to sessions">&larr;</button>
      <span v-if="displayDir" class="context-dir">{{ displayDir }}</span>
    </div>

    <div v-if="!isEmpty" ref="messagesEl" class="flex-1 overflow-y-auto">
      <div class="max-w-[720px] mx-auto px-6 py-8 space-y-6">
        <template v-for="(block, i) in blocks" :key="i">
          <div v-if="block.kind === 'user'" class="user-block">
            <pre class="whitespace-pre-wrap text-[15px] leading-relaxed font-medium" style="color: var(--color-text-primary)">{{ block.content }}</pre>
          </div>
          <div v-else-if="block.kind === 'text'" class="agent-block">
            <div class="markdown-body" v-html="renderMarkdown(block.content)"></div>
          </div>
          <div v-else-if="block.kind === 'tool'" class="tool-block">
            <button @click="toggleToolCall(block.tool)" class="tool-header" :class="{ 'tool-running': block.tool.isRunning, 'tool-error': block.tool.isError && !block.tool.isRunning }">
              <span class="tool-indicator" :class="{ active: block.tool.isRunning }"></span>
              <span class="tool-name">{{ block.tool.name }}</span>
              <span class="tool-summary">{{ toolSummary(block.tool) }}</span>
            </button>
            <div v-if="!block.tool.expanded && block.tool.result" class="tool-preview" @click="toggleToolCall(block.tool)">
              <pre class="tool-content" :class="{ 'tool-content-error': block.tool.isError }">{{ previewLines(block.tool.result) }}</pre>
            </div>
            <div v-if="block.tool.expanded && (block.tool.input || block.tool.result)" class="tool-body">
              <pre v-if="block.tool.input" class="tool-content">{{ block.tool.input }}</pre>
              <pre v-if="block.tool.result" class="tool-content" :class="{ 'tool-content-error': block.tool.isError }">{{ block.tool.result }}</pre>
            </div>
          </div>
        </template>
        <div v-if="isStreaming && blocks.length === 0" class="streaming-dot"></div>
      </div>
    </div>

    <div v-else class="flex-1"></div>

    <div class="input-area" :class="isEmpty ? 'input-centered' : 'input-docked'">
      <div class="max-w-[720px] mx-auto w-full px-6">
        <input
          v-model="input"
          @keydown.enter="send"
          :disabled="!isConnected || isStreaming"
          :placeholder="!isConnected ? 'Offline' : ''"
          class="input-field"
          aria-label="Message input"
        />
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
}
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
.input-area { padding: 24px 0 32px; }
.input-centered { display: flex; align-items: center; justify-content: center; }
.input-docked { border-top: 1px solid var(--color-border-subtle); }
.input-field {
  width: 100%;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 14px 18px;
  font-size: 15px;
  color: var(--color-text-primary);
  outline: none;
  transition: border-color 0.2s ease-out, box-shadow 0.2s ease-out;
}
.input-field:focus { border-color: var(--color-accent-dim); box-shadow: 0 0 0 3px oklch(0.72 0.14 55 / 0.08); }
.input-field:disabled { opacity: 0.4; cursor: not-allowed; }
.input-field::placeholder { color: var(--color-text-muted); }
.streaming-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-accent); animation: pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>