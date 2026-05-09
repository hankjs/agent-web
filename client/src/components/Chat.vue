<script setup lang="ts">
import { ref, nextTick, onMounted, computed, watch } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useSession, authFetch } from "../composables/useSession";
import { API_BASE } from "../config";
import { useMessageTree } from "../composables/useMessageTree";
import FolderPicker from "./FolderPicker.vue";

const props = defineProps<{
  sessionId: string;
  workDir?: string;
  title?: string;
  showOutlineToggle?: boolean;
}>();

const emit = defineEmits<{
  back: [];
  toggleOutline: [];
}>();

const { login, token: sessionToken, updateSessionTitle, updateSessionWorkDir } = useSession();
const { fetchTree, switchBranch, setActiveLeafId, activeLeafId, getSiblings, findLeafFromNode, hasBranching, treeNodes, scrollTargetId, clearScrollTarget } = useMessageTree();

const isEditingTitle = ref(false);
const editTitle = ref("");
const titleInputRef = ref<HTMLInputElement | null>(null);
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
  | { kind: "user"; content: string; messageId?: string; parentId?: string | null }
  | { kind: "text"; content: string }
  | { kind: "error"; content: string }
  | { kind: "tool"; tool: ToolCall };

type RenderItem =
  | { kind: "user"; content: string; messageId?: string; parentId?: string | null }
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

// SSE reconnection state
let lastEventId = "";
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAYS = [1000, 3000, 5000];
const HEARTBEAT_TIMEOUT = 20000;
let currentSessionStreaming = false; // tracks if we're in an active SSE session

// Editing state
const editingMessageId = ref<string | null>(null);
const editingContent = ref("");

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

async function loadHistory(leafId?: string) {
  try {
    const query = leafId ? `?leaf_id=${leafId}` : "";
    const res = await authFetch(`/api/sessions/${props.sessionId}/messages${query}`);
    if (!res.ok) return;
    const messages = await res.json();
    blocks.value = [];
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
              blocks.value.push({ kind: "user", content: block.text, messageId: msg.id, parentId: msg.parent_id });
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
    // Set active leaf from last message
    if (messages.length > 0) {
      setActiveLeafId(messages[messages.length - 1].id);
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
      currentSessionStreaming = false;
      clearHeartbeatTimer();
      reconnectAttempts = 0;
      fetchTree(props.sessionId);
      break;
    case "error":
      blocks.value.push({ kind: "error", content: event.message });
      isStreaming.value = false;
      currentSessionStreaming = false;
      clearHeartbeatTimer();
      break;
  }

  nextTick(() => {
    messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight, behavior: "smooth" });
  });
}

function resetHeartbeatTimer() {
  if (heartbeatTimer) clearTimeout(heartbeatTimer);
  if (!currentSessionStreaming) return;
  heartbeatTimer = setTimeout(() => {
    // Heartbeat timeout — connection is dead
    handleDisconnect();
  }, HEARTBEAT_TIMEOUT);
}

function clearHeartbeatTimer() {
  if (heartbeatTimer) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }
}

async function handleDisconnect() {
  clearHeartbeatTimer();
  // Cancel current reader
  if (activeReader) {
    try { await activeReader.cancel(); } catch { /* ignore */ }
    activeReader = null;
  }

  if (!currentSessionStreaming) return;

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    blocks.value.push({ kind: "error", content: "Connection lost. Reconnection failed after multiple attempts." });
    isStreaming.value = false;
    currentSessionStreaming = false;
    reconnectAttempts = 0;
    return;
  }

  const delay = RECONNECT_DELAYS[reconnectAttempts] || 5000;
  reconnectAttempts++;

  await new Promise((r) => setTimeout(r, delay));
  if (!currentSessionStreaming) return; // user may have stopped

  try {
    await resumeStream();
  } catch {
    // Will retry via heartbeat timeout
    handleDisconnect();
  }
}

async function resumeStream() {
  const res = await authFetch(
    `/api/sessions/${props.sessionId}/events/resume?last_event_id=${lastEventId}`
  );

  if (!res.ok) {
    throw new Error(`Resume failed: ${res.status}`);
  }

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
          if (eventType === "heartbeat") {
            resetHeartbeatTimer();
            currentId = "";
          }
        } else if (line.startsWith("data: ")) {
          const json = line.slice(6);
          if (json && json !== "{}") {
            try {
              handleServerEvent(JSON.parse(json));
              if (currentId) {
                lastEventId = currentId;
                reconnectAttempts = 0; // successful event resets retry count
              }
            } catch { /* malformed SSE */ }
          }
          resetHeartbeatTimer();
          currentId = "";
        }
      }
    }

    // Process remaining buffer
    if (buffer) {
      const lines = buffer.split("\n");
      for (const line of lines) {
        if (line.startsWith("id: ") || line.startsWith("id:")) {
          currentId = line.slice(line.indexOf(":") + 1).trim();
        } else if (line.startsWith("data: ")) {
          const json = line.slice(6);
          if (json && json !== "{}") {
            try {
              handleServerEvent(JSON.parse(json));
              if (currentId) lastEventId = currentId;
            } catch { /* malformed SSE */ }
          }
        }
      }
    }
  } catch (e: any) {
    if (e.name === "AbortError") return;
    // Connection error — trigger reconnect
    if (currentSessionStreaming) {
      handleDisconnect();
    }
  } finally {
    activeReader = null;
  }
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
  nextTick(() => titleInputRef.value?.focus());
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

// Message editing
function startEditMessage(item: RenderItem) {
  if (item.kind !== "user" || !item.messageId) return;
  editingMessageId.value = item.messageId;
  editingContent.value = item.content;
}

function cancelEditMessage() {
  editingMessageId.value = null;
  editingContent.value = "";
}

async function submitEditMessage() {
  if (!editingContent.value.trim() || !editingMessageId.value) return;
  const item = renderItems.value.find(
    (i) => i.kind === "user" && i.messageId === editingMessageId.value
  );
  if (!item || item.kind !== "user") return;

  const content = editingContent.value.trim();
  // For the first message (no parent), use "root" to signal branching from start
  const parentId = item.parentId || "root";

  editingMessageId.value = null;
  editingContent.value = "";

  await sendWithParent(content, parentId);
}

// Branch navigation
function getBranchSiblings(messageId: string) {
  return getSiblings(messageId);
}

function getBranchIndex(messageId: string): { current: number; total: number } {
  const siblings = getSiblings(messageId).filter((s) => s.role === "user");
  const idx = siblings.findIndex((s) => s.id === messageId);
  return { current: idx, total: siblings.length };
}

async function switchToBranch(siblingId: string) {
  const leafId = findLeafFromNode(siblingId);
  await switchBranch(props.sessionId, leafId);
  await loadHistory(leafId);
  await fetchTree(props.sessionId);
}

async function send(parentIdOverride?: string) {
  if (!input.value.trim() || !isConnected.value || isStreaming.value) return;

  const content = input.value.trim();
  blocks.value.push({ kind: "user", content });
  input.value = "";
  nextTick(() => {
    if (textareaRef.value) textareaRef.value.style.height = "auto";
    messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight });
  });
  isStreaming.value = true;
  currentSessionStreaming = true;
  lastEventId = "";
  reconnectAttempts = 0;

  const body: any = { content };
  if (parentIdOverride) {
    body.parent_id = parentIdOverride;
  }

  try {
    const res = await authFetch(
      `/api/sessions/${props.sessionId}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      blocks.value.push({ kind: "error", content: `Request failed: ${res.status}` });
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
    if (currentSessionStreaming) {
      handleDisconnect();
    } else {
      blocks.value.push({ kind: "error", content: `Connection lost: ${e.message || e}` });
      isStreaming.value = false;
    }
  }
}

async function sendWithParent(content: string, parentId?: string) {
  if (!content.trim() || !isConnected.value || isStreaming.value) return;

  // Truncate blocks to show only up to the branch point
  if (parentId === "root") {
    blocks.value.splice(0);
  } else if (parentId) {
    let cutIdx = -1;
    for (let i = 0; i < blocks.value.length; i++) {
      const b = blocks.value[i];
      if (b.kind === "user" && b.parentId === parentId) {
        cutIdx = i;
        break;
      }
    }
    if (cutIdx >= 0) {
      blocks.value.splice(cutIdx);
    }
  }

  blocks.value.push({ kind: "user", content });
  isStreaming.value = true;
  currentSessionStreaming = true;
  lastEventId = "";
  reconnectAttempts = 0;

  nextTick(() => {
    messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight });
  });

  const body: any = { content };
  if (parentId) body.parent_id = parentId;

  try {
    const res = await authFetch(
      `/api/sessions/${props.sessionId}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      blocks.value.push({ kind: "error", content: `Request failed: ${res.status}` });
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
    if (currentSessionStreaming) {
      handleDisconnect();
    } else {
      blocks.value.push({ kind: "error", content: `Connection lost: ${e.message || e}` });
      isStreaming.value = false;
    }
  }
}

async function stop() {
  currentSessionStreaming = false;
  clearHeartbeatTimer();
  reconnectAttempts = 0;

  // Cancel client-side reader
  if (activeReader) {
    try { await activeReader.cancel(); } catch { /* ignore */ }
    activeReader = null;
  }
  // Tell server to cancel
  try {
    await authFetch(`/api/sessions/${props.sessionId}/stop`, { method: "POST" });
  } catch { /* best effort */ }

  // Mark running tools as stopped but keep their groups expanded
  const items = renderItems.value;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "tool-group" && item.tools.some((t) => t.isRunning)) {
      groupExpanded.value[i] = true;
      for (const tc of item.tools) {
        if (tc.isRunning) tc.isRunning = false;
      }
    } else if (item.kind === "tool" && item.tool.isRunning) {
      item.tool.isRunning = false;
    }
  }

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
  currentSessionStreaming = true;
  lastEventId = "";
  reconnectAttempts = 0;

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
      currentSessionStreaming = false;
      return;
    }

    const reader = res.body!.getReader();
    activeReader = reader;
    resetHeartbeatTimer();
    await readSSEStream(reader);
  } catch (e: any) {
    if (e.name === "AbortError") return;
    if (currentSessionStreaming) {
      handleDisconnect();
    } else {
      blocks.value.push({ kind: "error", content: `Connection lost: ${e.message || e}` });
      isStreaming.value = false;
    }
  }
}

onMounted(async () => {
  await connect();
  await loadHistory();
  await fetchTree(props.sessionId);
  nextTick(() => {
    messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight });
  });
});

// Watch for external branch switches (from outline panel)
let internalLeafChange = false;
watch(activeLeafId, async (newLeaf, oldLeaf) => {
  if (internalLeafChange) {
    internalLeafChange = false;
    return;
  }
  if (newLeaf && newLeaf !== oldLeaf && !isStreaming.value) {
    await loadHistory(newLeaf);
    nextTick(() => {
      scrollToMessageId(scrollTargetId.value);
    });
  }
});

// Watch for scroll requests from outline panel
watch(scrollTargetId, (id) => {
  if (id) {
    nextTick(() => scrollToMessageId(id));
  }
});

function scrollToMessageId(id: string | null) {
  if (!id) return;
  clearScrollTarget();
  const el = messagesEl.value?.querySelector(`[data-message-id="${id}"]`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="context-bar">
      <button class="back-btn" @click="emit('back')" aria-label="Back to sessions">&larr;</button>
      <template v-if="isEditingTitle">
        <input
          ref="titleInputRef"
          v-model="editTitle"
          class="title-input"
          @keydown.enter="confirmEditTitle"
          @keydown.escape="cancelEditTitle"
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
      <button
        v-if="showOutlineToggle"
        class="outline-toggle-btn"
        @click="emit('toggleOutline')"
        aria-label="Toggle outline"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
          <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
      </button>
    </div>

    <div v-if="!isEmpty" ref="messagesEl" class="flex-1 overflow-y-auto">
      <div class="max-w-[720px] mx-auto px-6 py-8 space-y-6">
        <template v-for="(item, idx) in renderItems" :key="idx">
          <div v-if="item.kind === 'user'" class="user-block" :data-message-id="item.messageId">
            <!-- Branch navigation -->
            <div v-if="item.messageId && getBranchIndex(item.messageId).total > 1" class="branch-nav">
              <button
                class="branch-arrow"
                :disabled="getBranchIndex(item.messageId).current === 0"
                @click="switchToBranch(getBranchSiblings(item.messageId!).filter(s => s.role === 'user')[getBranchIndex(item.messageId!).current - 1].id)"
                aria-label="Previous branch"
              >&lsaquo;</button>
              <span class="branch-indicator">{{ getBranchIndex(item.messageId).current + 1 }}/{{ getBranchIndex(item.messageId).total }}</span>
              <button
                class="branch-arrow"
                :disabled="getBranchIndex(item.messageId).current === getBranchIndex(item.messageId).total - 1"
                @click="switchToBranch(getBranchSiblings(item.messageId!).filter(s => s.role === 'user')[getBranchIndex(item.messageId!).current + 1].id)"
                aria-label="Next branch"
              >&rsaquo;</button>
            </div>
            <!-- Edit mode -->
            <div v-if="editingMessageId === item.messageId" class="edit-inline">
              <textarea
                v-model="editingContent"
                class="edit-textarea"
                @keydown.enter.exact.prevent="submitEditMessage"
                @keydown.escape="cancelEditMessage"
                rows="3"
              ></textarea>
              <div class="edit-actions">
                <button class="edit-submit" @click="submitEditMessage">Submit</button>
                <button class="edit-cancel" @click="cancelEditMessage">Cancel</button>
              </div>
            </div>
            <!-- Normal display -->
            <div v-else class="user-content-row">
              <pre class="whitespace-pre-wrap text-[15px] leading-relaxed font-medium" style="color: var(--color-text-primary)">{{ item.content }}</pre>
              <button
                v-if="!isStreaming"
                class="edit-btn"
                @click="startEditMessage(item)"
                aria-label="Edit message"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
            </div>
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
.user-content-row { display: flex; align-items: flex-start; gap: 8px; position: relative; }
.user-content-row pre { flex: 1; min-width: 0; }
.edit-btn {
  opacity: 0;
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: opacity 0.15s, color 0.15s;
  margin-top: 2px;
}
.user-block:hover .edit-btn { opacity: 1; }
.edit-btn:hover { color: var(--color-text-primary); }
.edit-inline { margin-top: 4px; }
.edit-textarea {
  width: 100%;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 14px;
  color: var(--color-text-primary);
  font-family: inherit;
  resize: vertical;
  outline: none;
  line-height: 1.5;
}
.edit-textarea:focus { border-color: var(--color-accent-dim); }
.edit-actions { display: flex; gap: 8px; margin-top: 8px; justify-content: flex-end; }
.edit-submit {
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  border-radius: 4px;
  background: var(--color-text-primary);
  color: var(--color-surface-0, #1a1a1a);
  cursor: pointer;
}
.edit-submit:hover { opacity: 0.85; }
.edit-cancel {
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
}
.edit-cancel:hover { color: var(--color-text-primary); }
.branch-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}
.branch-arrow {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
  border-radius: 3px;
  line-height: 1;
}
.branch-arrow:hover:not(:disabled) { color: var(--color-text-primary); background: var(--color-surface-1); }
.branch-arrow:disabled { opacity: 0.3; cursor: not-allowed; }
.branch-indicator {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-muted);
}
.outline-toggle-btn {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  transition: color 0.12s, background 0.12s;
}
.outline-toggle-btn:hover { color: var(--color-text-primary); background: var(--color-surface-1); }
</style>