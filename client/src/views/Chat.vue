<script setup lang="ts">
import { ref, reactive, nextTick, onMounted, onUnmounted, onDeactivated, computed, watch } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useSession, authFetch, apiRequest } from "../composables/useSession";
import { API_BASE } from "../config";
import { useMessageTree } from "../composables/useMessageTree";
import { useMessage } from "../composables/useMessage";
import { useSidebarPanels } from "../composables/useSidebarPanels";
import { listCheckpoints, rewindToCheckpoint, type Checkpoint } from "../api/checkpoints";
import { getApplyContext } from "../api/changes";
import { buildApplyPrompt } from "../agents/ChangeAgent";
import AgentHeader from "../components/AgentHeader.vue";
import AgentInput from "../components/AgentInput.vue";
import FolderPicker from "../components/FolderPicker.vue";
import ChangeChatPanel from "../panels/ChangeChatPanel.vue";
import ArtifactReview from "../components/ArtifactReview.vue";
import ConversationOutline from "../components/ConversationOutline.vue";
import SpecPanel from "../panels/SpecPanel.vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

const props = defineProps<{
  sessionId: string;
}>();

const { login, token: sessionToken, updateSessionTitle, updateSessionWorkDir, selectSession, sessions, currentSession, createSession, goBack, navigateTo } = useSession();
const { fetchTree, switchBranch, setActiveLeafId, activeLeafId, getSiblings, findLeafFromNode, hasBranching, treeNodes, scrollTargetId, clearScrollTarget } = useMessageTree();
const { warning: showWarning } = useMessage();

const isEditingWorkDir = ref(false);
const editWorkDir = ref("");
const sessionTitle = computed(() => currentSession.value?.title || "");
const sessionWorkDir = computed(() => currentSession.value?.work_dir || "");

// Sidebar panels
const { activePanelId, closePanel, registerPanel, reset: resetPanels } = useSidebarPanels();
registerPanel({ id: "changes", icon: "changes", title: "需求", order: 1 });
registerPanel({ id: "specs", icon: "specs", title: "Specs", order: 2 });
registerPanel({ id: "outline", icon: "outline", title: "Outline", order: 3 });

interface ToolCall {
  id: string;
  name: string;
  input?: string;
  result?: string;
  isError?: boolean;
  isRunning: boolean;
  expanded: boolean;
  source?: "local" | "remote";
}

type AskUserQuestion = { header: string; question: string; options: string[]; selected?: string; customMode?: boolean; customAnswer?: string };

type Block =
  | { kind: "user"; content: string; images?: Array<{ media_type: string; data: string }>; messageId?: string; parentId?: string | null }
  | { kind: "text"; content: string }
  | { kind: "error"; content: string }
  | { kind: "tool"; tool: ToolCall }
  | { kind: "ask_user"; toolUseId: string; questions: AskUserQuestion[]; answered: boolean; activeTab: number };

type RenderItem =
  | { kind: "user"; content: string; images?: Array<{ media_type: string; data: string }>; messageId?: string; parentId?: string | null }
  | { kind: "text"; content: string }
  | { kind: "structured"; cardType: string; data: any }
  | { kind: "error"; content: string }
  | { kind: "tool"; tool: ToolCall }
  | { kind: "tool-group"; tools: ToolCall[] }
  | { kind: "ask_user"; toolUseId: string; questions: AskUserQuestion[]; answered: boolean; activeTab: number };

const blocks = ref<Block[]>([]);
const input = ref("");
const isConnected = ref(false);
const isStreaming = ref(false);
const messagesEl = ref<HTMLElement | null>(null);
const agentInputRef = ref<InstanceType<typeof AgentInput> | null>(null);
const changesPanelRefreshKey = ref(0);
const reviewingChangeId = ref<string | null>(null);
const activeApplyChangeId = ref<string | null>(null);
const isCreatingSession = ref(false);
let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

// Checkpoint state
const checkpoints = ref<Checkpoint[]>([]);
const rewindingTo = ref<string | null>(null);

async function fetchCheckpoints() {
  try {
    checkpoints.value = await listCheckpoints(props.sessionId);
  } catch { checkpoints.value = []; }
}

function getCheckpointForMessage(messageId: string): Checkpoint | undefined {
  return checkpoints.value.find(cp => cp.message_id === messageId);
}

async function handleRewind(checkpoint: Checkpoint) {
  if (!confirm(`回退到此消息时的状态？文件和对话都会恢复到这个时间点。`)) return;
  rewindingTo.value = checkpoint.id;
  try {
    await rewindToCheckpoint(props.sessionId, checkpoint.id);
    // 刷新页面状态
    await fetchTree(props.sessionId);
    await loadHistory();
    await fetchCheckpoints();
  } catch (e: any) {
    alert(`回退失败: ${e.message || e}`);
  } finally {
    rewindingTo.value = null;
  }
}

// Image state is managed by AgentInput component
import type { PendingImage } from "../components/AgentInput.vue";
const pendingImages = ref<PendingImage[]>([]);

function handleImagesChange(images: PendingImage[]) {
  pendingImages.value = images;
}

// SSE reconnection state
let lastEventId = "";
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAYS = [1000, 3000, 5000];
const HEARTBEAT_TIMEOUT = 20000;
let currentSessionStreaming = false; // tracks if we're in an active SSE session

// Local ACP agent state
const sessionEnvironment = computed(() => currentSession.value?.environment || "remote");
const configuredAgents = ref<Array<{ name: string; agent_type: string; binary_path: string }>>([]);
const serverProviders = ref<Array<{ name: string; type: string; default_model: string }>>([]);

import type { ProviderOption } from "../components/AgentInput.vue";

const providerOptions = computed<ProviderOption[]>(() => {
  const opts: ProviderOption[] = [];
  if (sessionEnvironment.value === "local") {
    for (const a of configuredAgents.value) {
      opts.push({ name: a.name, key: `local:${a.name}`, source: "local" });
    }
    for (const p of serverProviders.value) {
      opts.push({ name: p.name, key: `server:${p.name}`, source: "server" });
    }
  } else {
    opts.push({ name: "hank-agent", key: "server:hank-agent", source: "server" });
  }
  return opts;
});
const selectedProvider = ref("");
const showProviderDropdown = ref(false);
watch(providerOptions, (opts) => {
  if (opts.length > 0 && !opts.find(o => o.key === selectedProvider.value)) {
    selectedProvider.value = opts[0].key;
  }
}, { immediate: true });

const selectedProviderSource = computed<"local" | "server">(() => {
  const opt = providerOptions.value.find(o => o.key === selectedProvider.value);
  return opt?.source || "local";
});
const selectedProviderName = computed(() => {
  const opt = providerOptions.value.find(o => o.key === selectedProvider.value);
  return opt?.name || "";
});

const localAgentStatus = ref<"running" | "stopped" | "not_configured">("not_configured");
const localAgentName = computed(() => selectedProviderName.value);
// When user switches provider, stop the current local session so next prompt creates a new one
watch(selectedProvider, async (_newVal, oldVal) => {
  if (localAgentStatus.value === "running") {
    // Only stop local agent if the previous selection was a local provider
    const oldOpt = providerOptions.value.find(o => o.key === oldVal);
    if (oldOpt?.source === "local") {
      try {
        await invoke("acp_stop", { sessionId: props.sessionId });
      } catch { /* ignore */ }
      localAgentStatus.value = "stopped";
    }
  }
});
let acpUnlisten: UnlistenFn | null = null;
let localEvents: Array<{ event_type: string; agent_type: string; payload: any }> = [];
let localUserMessageId: string | null = null; // track saved user message id for parent linking
let localAssistantBlocks: Array<any> = []; // accumulate assistant content blocks

// Editing state
const editingMessageId = ref<string | null>(null);
const editingContent = ref("");

const isEmpty = computed(() => blocks.value.length === 0 && !isStreaming.value);

const groupExpanded = ref<Record<number, boolean>>({});

const structuredBlockRegex = /```structured:(\w+)\n([\s\S]*?)\n```/g;
const structuredAskCache = new Map<string, any>();

function splitTextWithStructured(content: string): RenderItem[] {
  const parts: RenderItem[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  structuredBlockRegex.lastIndex = 0;
  while ((match = structuredBlockRegex.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index);
    if (before.trim()) parts.push({ kind: "text", content: before });
    try {
      const raw = match[2];
      const cardType = match[1];
      // For ask cards, use cache to preserve interactive state
      if (cardType === "ask") {
        const cacheKey = raw;
        if (!structuredAskCache.has(cacheKey)) {
          const data = JSON.parse(raw);
          data._activeTab = 0;
          data._answered = false;
          for (const q of data.questions || []) {
            q._selected = q.multiSelect ? [] : undefined;
            q._customMode = false;
            q._customAnswer = "";
          }
          structuredAskCache.set(cacheKey, reactive(data));
        }
        parts.push({ kind: "structured", cardType, data: structuredAskCache.get(cacheKey) });
      } else {
        const data = JSON.parse(raw);
        parts.push({ kind: "structured", cardType, data });
      }
    } catch {
      parts.push({ kind: "text", content: match[0] });
    }
    lastIndex = match.index + match[0].length;
  }
  const after = content.slice(lastIndex);
  if (after.trim()) parts.push({ kind: "text", content: after });
  return parts;
}

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
    } else if (block.kind === "ask_user") {
      // 去重：跳过与前一个 ask_user 问题完全相同的重复块
      const prev = items[items.length - 1];
      if (prev && prev.kind === "ask_user" && prev.questions.length === block.questions.length &&
          prev.questions.every((q, qi) => q.question === block.questions[qi].question)) {
        i++;
      } else {
        items.push(block);
        i++;
      }
    } else if (block.kind === "text" && (structuredBlockRegex.lastIndex = 0, structuredBlockRegex.test(block.content))) {
      // 流式中只跳过最后一个 text block（正在写入的），之前的都正常解析
      const isLastBlock = i === blocks.value.length - 1;
      if (isStreaming.value && isLastBlock) {
        items.push(block);
      } else {
        structuredBlockRegex.lastIndex = 0;
        items.push(...splitTextWithStructured(block.content));
      }
      i++;
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

// Collapse tool groups that have no running tools (called when a new non-tool block starts)
function collapseFinishedToolGroups() {
  const items = renderItems.value;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "tool-group" && !item.tools.some((t) => t.isRunning)) {
      if (groupExpanded.value[i] === undefined || groupExpanded.value[i]) {
        groupExpanded.value[i] = false;
      }
    }
  }
}

function groupSummary(tools: ToolCall[]): string {
  // If the group contains an Agent tool, use its subagent_type as the group label
  const agentTool = tools.find((t) => t.name === "Agent");
  let agentLabel = "";
  if (agentTool && agentTool.input) {
    try {
      const parsed = JSON.parse(agentTool.input);
      if (parsed.subagent_type) agentLabel = parsed.subagent_type;
    } catch { /* ignore */ }
  }

  const counts: Record<string, number> = {};
  for (const t of tools) {
    if (t.name === "Agent" && agentLabel) continue; // exclude Agent from inner list
    counts[t.name] = (counts[t.name] || 0) + 1;
  }
  const inner = Object.entries(counts)
    .map(([name, count]) => count > 1 ? `${name} x${count}` : name)
    .join(", ");

  if (agentLabel) {
    return inner ? `${agentLabel}(${inner})` : agentLabel;
  }
  return Object.entries(counts)
    .map(([name, count]) => `${name} x${count}`)
    .join(", ");
}

const displayDir = computed(() => {
  return currentSession.value?.work_dir || "";
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

async function restoreInitialPrompt() {
  const key = `hank_initial_prompt:${props.sessionId}`;
  const raw = sessionStorage.getItem(key);
  if (!raw) return;
  if (blocks.value.length > 0 || input.value.trim()) {
    sessionStorage.removeItem(key);
    return;
  }

  try {
    const parsed = JSON.parse(raw) as { content?: string; autoSend?: boolean };
    if (parsed.autoSend && (!isConnected.value || isStreaming.value)) {
      return;
    }
    sessionStorage.removeItem(key);
    input.value = parsed.content || "";
    await nextTick();
    autoResize();
    if (parsed.autoSend && input.value.trim()) {
      await send();
    }
  } catch {
    sessionStorage.removeItem(key);
    input.value = raw;
    await nextTick();
    autoResize();
  }
}

async function connect() {
  isConnected.value = !!sessionToken.value;
}

async function loadHistory(leafId?: string) {
  try {
    const query = leafId ? `?leaf_id=${leafId}` : "";
    const result = await apiRequest<any[]>(`/api/sessions/${props.sessionId}/messages${query}`);
    if (!result.ok || !result.data) return;
    const messages = result.data;
    blocks.value = [];
    for (const msg of messages) {
      try {
        const content = JSON.parse(msg.content);
        if (msg.role === "user") {
          let textContent = "";
          const images: Array<{ media_type: string; data: string }> = [];
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
            } else if (block.type === "image" && block.source) {
              images.push({ media_type: block.source.media_type, data: block.source.data });
            } else if (block.text) {
              textContent = block.text;
            }
          }
          // Check if this user message is an ask_user answer: [toolUseId]JSON
          const askMatch = textContent.match(/^\[([^\]]+)\]([\s\S]*)$/);
          if (askMatch) {
            const matchedId = askMatch[1];
            const answerBody = askMatch[2];
            // Find the corresponding ask_user block and mark it answered
            for (let i = blocks.value.length - 1; i >= 0; i--) {
              const b = blocks.value[i];
              if (b.kind === "ask_user" && b.toolUseId === matchedId) {
                b.answered = true;
                // Parse JSON payload
                try {
                  const payload = JSON.parse(answerBody) as Array<{ header: string; answer: string }>;
                  for (let qi = 0; qi < b.questions.length && qi < payload.length; qi++) {
                    b.questions[qi].selected = payload[qi].answer;
                  }
                } catch {
                  // Fallback: legacy line-based format
                  const lines = answerBody.split("\n").filter(l => l.trim());
                  for (let qi = 0; qi < b.questions.length && qi < lines.length; qi++) {
                    const colonIdx = lines[qi].indexOf(": ");
                    b.questions[qi].selected = colonIdx >= 0 ? lines[qi].slice(colonIdx + 2) : lines[qi];
                  }
                }
                break;
              }
            }
            // Don't show the raw [id]answer as a user bubble
          } else if (textContent || images.length > 0) {
            blocks.value.push({ kind: "user", content: textContent, images: images.length > 0 ? images : undefined, messageId: msg.id, parentId: msg.parent_id });
          }
        } else {
          let skipNextText = false;
          for (const block of content) {
            if (block.type === "text" && block.text) {
              if (skipNextText) {
                skipNextText = false;
                continue;
              }
              blocks.value.push({ kind: "text", content: block.text });
            } else if (block.type === "error" && block.text) {
              blocks.value.push({ kind: "error", content: block.text });
            } else if (block.type === "tool_use") {
              // Render AskUserQuestion as interactive card
              if (block.name === "AskUserQuestion") {
                const inputData = typeof block.input === "string" ? JSON.parse(block.input) : block.input;
                const rawQuestions = inputData.questions || [];
                if (rawQuestions.length > 0) {
                  const questions: AskUserQuestion[] = rawQuestions.map((q: any) => ({
                    header: q.header || "",
                    question: q.question || "",
                    options: (q.options || []).map((o: any) => o.label || o),
                    selected: undefined,
                    customMode: false,
                    customAnswer: "",
                  }));
                  blocks.value.push({
                    kind: "ask_user",
                    toolUseId: block.id || "",
                    questions,
                    answered: false,
                    activeTab: 0,
                  });
                }
                skipNextText = true;
              } else {
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
        // New non-tool block starting — collapse previous tool groups that are done
        collapseFinishedToolGroups();
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
    case "ask_user":
      blocks.value.push({
        kind: "ask_user",
        toolUseId: event.tool_use_id || "",
        questions: [{
          header: "",
          question: event.question,
          options: event.options || [],
          selected: undefined,
          customMode: false,
          customAnswer: "",
        }],
        answered: false,
        activeTab: 0,
      });
      break;
    case "explore_complete":
    case "generate_complete":
    case "task_updated":
      changesPanelRefreshKey.value++;
      break;
  }

  // Auto-scroll: keep last content visible at bottom (exclude scroll-spacer)
  nextTick(() => {
    if (!messagesEl.value) return;
    const spacer = messagesEl.value.querySelector('.scroll-spacer') as HTMLElement | null;
    if (spacer) {
      // Scroll so the spacer's top aligns with the container's bottom
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
    blocks.value.push({ kind: "error", content: "连接断开，多次重连失败。" });
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

function autoResize() {
  // Delegated to AgentInput component
}

async function handleUpdateTitle(newTitle: string) {
  await updateSessionTitle(props.sessionId, newTitle);
}

function startEditWorkDir() {
  editWorkDir.value = currentSession.value?.work_dir || "";
  isEditingWorkDir.value = true;
}

function cancelEditWorkDir() {
  isEditingWorkDir.value = false;
}

async function confirmEditWorkDir() {
  const newDir = editWorkDir.value.trim() || null;
  isEditingWorkDir.value = false;
  if (newDir !== (currentSession.value?.work_dir || null)) {
    await updateSessionWorkDir(props.sessionId, newDir);
  }
}

async function startSessionFromCurrentDir() {
  if (isCreatingSession.value) return;
  if (blocks.value.length === 0) {
    showWarning("当前还未开始对话");
    return;
  }
  isCreatingSession.value = true;
  try {
    const workDir = currentSession.value?.work_dir || undefined;
    const environment = currentSession.value?.environment || "remote";
    const session = await createSession(workDir, environment, "chat");
    if (session) {
      await navigateTo("chat", { sessionId: session.id });
    } else {
      showWarning("新建会话失败");
    }
  } catch (e: any) {
    showWarning(e?.message || "新建会话失败");
  } finally {
    isCreatingSession.value = false;
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
  // Route based on selected provider source
  if (sessionEnvironment.value === "local" && selectedProviderSource.value === "local") {
    return sendLocal();
  }
  if (!input.value.trim() && pendingImages.value.length === 0 || !isConnected.value || isStreaming.value) return;

  const content = input.value.trim();
  const images = pendingImages.value.length > 0
    ? pendingImages.value.map(img => ({ media_type: img.media_type, data: img.data }))
    : undefined;
  blocks.value.push({ kind: "user", content, images });
  input.value = "";
  pendingImages.value = [];
  agentInputRef.value?.clearImages();
  nextTick(() => {
    scrollToLastUserMessage();
  });
  isStreaming.value = true;
  currentSessionStreaming = true;
  lastEventId = "";
  reconnectAttempts = 0;

  const body: any = { content };
  if (images) {
    body.images = images;
  }
  if (parentIdOverride) {
    body.parent_id = parentIdOverride;
  }
  // When a local session uses a server provider, pass the provider name
  if (sessionEnvironment.value === "local" && selectedProviderSource.value === "server") {
    body.provider = selectedProviderName.value;
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

function selectAskUserOption(item: Extract<RenderItem, { kind: "ask_user" }>, qIdx: number, answer: string) {
  if (item.answered || isStreaming.value) return;
  const q = item.questions[qIdx];
  if (!q) return;
  q.selected = answer;
  q.customMode = false;
  q.customAnswer = "";
  // 单选自动跳转下一题
  if (qIdx < item.questions.length - 1) {
    item.activeTab = qIdx + 1;
  }
}

function startCustomAskUser(item: Extract<RenderItem, { kind: "ask_user" }>, qIdx: number) {
  if (item.answered || isStreaming.value) return;
  const q = item.questions[qIdx];
  if (!q) return;
  q.selected = "";
  q.customMode = true;
  q.customAnswer = "";
  nextTick(() => {
    const inputs = document.querySelectorAll<HTMLInputElement>(".ask-card-custom-input");
    inputs[inputs.length - 1]?.focus();
  });
}

async function submitAskUser(item: Extract<RenderItem, { kind: "ask_user" }>) {
  if (item.answered || isStreaming.value) return;
  // Collect answers from all questions
  const answers: string[] = [];
  for (const q of item.questions) {
    const answer = q.customMode ? (q.customAnswer || "").trim() : (q.selected || "").trim();
    if (!answer) return; // all questions must be answered
    answers.push(answer);
  }
  await answerAskUser(item, answers);
}

async function answerAskUser(item: Extract<RenderItem, { kind: "ask_user" }>, answers: string[]) {
  item.answered = true;
  // Format as JSON with tool_use_id prefix for reliable parsing
  const payload = item.questions.map((q, i) => ({ header: q.header || q.question, answer: answers[i] }));
  input.value = `[${item.toolUseId}]${JSON.stringify(payload)}`;
  await send();
}

function selectStructuredAskOption(item: Extract<RenderItem, { kind: "structured" }>, qIdx: number, answer: string) {
  if (item.data._answered || isStreaming.value) return;
  const q = item.data.questions[qIdx];
  if (!q) return;
  if (q.multiSelect) {
    const arr: string[] = q._selected || [];
    const idx = arr.indexOf(answer);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(answer);
    q._selected = [...arr];
  } else {
    q._selected = answer;
    // 单选自动跳转下一题
    if (qIdx < item.data.questions.length - 1) {
      item.data._activeTab = qIdx + 1;
    }
  }
  q._customMode = false;
  q._customAnswer = "";
}

function startStructuredAskCustom(item: Extract<RenderItem, { kind: "structured" }>, qIdx: number) {
  if (item.data._answered || isStreaming.value) return;
  const q = item.data.questions[qIdx];
  if (!q) return;
  q._selected = q.multiSelect ? [] : undefined;
  q._customMode = true;
  q._customAnswer = "";
}

async function submitStructuredAsk(item: Extract<RenderItem, { kind: "structured" }>) {
  if (item.data._answered || isStreaming.value) return;
  const answers: (string | string[])[] = [];
  for (const q of item.data.questions) {
    if (q._customMode) {
      const val = (q._customAnswer || "").trim();
      if (!val) return;
      answers.push(val);
    } else if (q.multiSelect) {
      const arr = q._selected || [];
      if (arr.length === 0) return;
      answers.push(arr);
    } else {
      const val = (q._selected || "").trim();
      if (!val) return;
      answers.push(val);
    }
  }
  item.data._answered = true;
  const payload = item.data.questions.map((q: any, i: number) => ({ header: q.header || q.question, answer: answers[i] }));
  input.value = JSON.stringify(payload);
  await send();
}

function handleNavigateSession(sessionId: string) {
  const session = sessions.value.find(s => s.id === sessionId);
  if (session) {
    selectSession(session);
  }
}

async function handleApplyChange(changeId: string) {
  if (!isConnected.value || isStreaming.value) return;
  closePanel();
  activeApplyChangeId.value = changeId;

  const ctxResult = await getApplyContext(changeId);
  if (!ctxResult.ok || !ctxResult.data) {
    showWarning(ctxResult.msg || "获取 Change 上下文失败");
    return;
  }

  const content = buildApplyPrompt({ changeContext: ctxResult.data.context });
  blocks.value.push({ kind: "user", content });
  isStreaming.value = true;
  currentSessionStreaming = true;
  lastEventId = "";
  reconnectAttempts = 0;
  nextTick(() => scrollToLastUserMessage());

  try {
    const res = await authFetch(
      `/api/sessions/${props.sessionId}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, apply_change_id: changeId }),
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

function handleReviewChange(changeId: string) {
  reviewingChangeId.value = changeId;
  closePanel();
}

function handleReviewConfirmed() {
  reviewingChangeId.value = null;
  changesPanelRefreshKey.value++;
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
    scrollToLastUserMessage();
  });

  const body: any = { content };
  if (parentId) body.parent_id = parentId;
  // When a local session uses a server provider, pass the provider name
  if (sessionEnvironment.value === "local" && selectedProviderSource.value === "server") {
    body.provider = selectedProviderName.value;
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

async function stop() {
  // Handle local agent cancel
  if (sessionEnvironment.value === "local" && selectedProviderSource.value === "local") {
    return stopLocal();
  }
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

// --- Local ACP Agent Functions ---

async function handleAcpEvent(event: any) {
  const eventType = event.type;
  // Collect events for batch upload
  localEvents.push({ event_type: eventType, agent_type: localAgentName.value, payload: event });

  switch (eventType) {
    case "text_delta": {
      const last = blocks.value[blocks.value.length - 1];
      if (last && last.kind === "text") {
        last.content += event.content;
        // Append to last text block in assistant accumulator
        const lastAcc = localAssistantBlocks[localAssistantBlocks.length - 1];
        if (lastAcc && lastAcc.type === "text") {
          lastAcc.text += event.content;
        } else {
          localAssistantBlocks.push({ type: "text", text: event.content });
        }
      } else {
        collapseFinishedToolGroups();
        blocks.value.push({ kind: "text", content: event.content });
        localAssistantBlocks.push({ type: "text", text: event.content });
      }
      break;
    }
    case "tool_use": {
      // Intercept AskUserQuestion tool and render as ask_user card
      if (event.tool_name === "AskUserQuestion") {
        const inputData = typeof event.input === "string" ? JSON.parse(event.input) : event.input;
        const rawQuestions = inputData.questions || [];
        if (rawQuestions.length > 0) {
          const questions: AskUserQuestion[] = rawQuestions.map((q: any) => ({
            header: q.header || "",
            question: q.question || "",
            options: (q.options || []).map((o: any) => o.label || o),
            selected: undefined,
            customMode: false,
            customAnswer: "",
          }));
          blocks.value.push({
            kind: "ask_user",
            toolUseId: event.tool_call_id || "",
            questions,
            answered: false,
            activeTab: 0,
          });
        }
        localAssistantBlocks.push({
          type: "tool_use",
          id: event.tool_call_id,
          name: event.tool_name,
          input: event.input,
        });
        break;
      }
      blocks.value.push({
        kind: "tool",
        tool: {
          id: event.tool_call_id,
          name: event.tool_name,
          input: typeof event.input === "string" ? event.input : JSON.stringify(event.input),
          isRunning: true,
          expanded: false,
          source: "local",
        },
      });
      localAssistantBlocks.push({
        type: "tool_use",
        id: event.tool_call_id,
        name: event.tool_name,
        input: event.input,
      });
      break;
    }
    case "tool_result": {
      for (let i = blocks.value.length - 1; i >= 0; i--) {
        const b = blocks.value[i];
        if (b.kind === "tool" && b.tool.id === event.tool_call_id) {
          b.tool.result = typeof event.output === "string" ? event.output : JSON.stringify(event.output);
          b.tool.isError = event.is_error;
          b.tool.isRunning = false;
          break;
        }
      }
      // tool_result goes into the next user message content (Anthropic format),
      // but for display purposes we store it as part of the assistant turn
      break;
    }
    case "done": {
      isStreaming.value = false;
      localAgentStatus.value = "stopped";
      // Save assistant message and upload local events
      await saveLocalAssistantMessage();
      uploadLocalEvents();
      break;
    }
    case "error": {
      blocks.value.push({ kind: "error", content: event.message });
      isStreaming.value = false;
      localAgentStatus.value = "stopped";
      break;
    }
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

async function sendLocal() {
  if (!input.value.trim() || isStreaming.value) return;
  if (!localAgentName.value) {
    blocks.value.push({ kind: "error", content: "本地 Agent 未配置，请在设置中配置 Agent。" });
    return;
  }

  const content = input.value.trim();
  blocks.value.push({ kind: "user", content });
  input.value = "";
  nextTick(() => {
    scrollToLastUserMessage();
  });
  isStreaming.value = true;
  localEvents = [];
  localAssistantBlocks = [];
  localUserMessageId = null;

  // Save user message to server
  try {
    const userContent = [{ type: "text", text: content }];
    const parentId = activeLeafId.value || undefined;
    const res = await authFetch(`/api/sessions/${props.sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user", content: userContent, parent_id: parentId }),
    });
    if (res.ok) {
      const data = await res.json();
      localUserMessageId = data.id;
      setActiveLeafId(data.id);
    }
  } catch { /* best effort */ }

  // Also add user prompt to local events for admin visibility
  localEvents.push({ event_type: "user_message", agent_type: localAgentName.value, payload: { text: content } });

  try {
    // Start ACP session if not already running
    if (localAgentStatus.value !== "running") {
      const workDir = currentSession.value?.work_dir || ".";
      await invoke("acp_new_session", {
        agentName: localAgentName.value,
        workDir,
        sessionId: props.sessionId,
      });
      localAgentStatus.value = "running";
    }

    // Send prompt (non-blocking — events come via acp-event listener)
    await invoke("acp_prompt", {
      sessionId: props.sessionId,
      message: content,
    });
  } catch (e: any) {
    blocks.value.push({ kind: "error", content: `Local agent error: ${e}` });
    isStreaming.value = false;
  }
}

async function stopLocal() {
  try {
    await invoke("acp_cancel", { sessionId: props.sessionId });
  } catch { /* best effort */ }
  isStreaming.value = false;
}

async function uploadLocalEvents() {
  if (localEvents.length === 0) return;
  try {
    await authFetch(`/api/sessions/${props.sessionId}/local-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(localEvents),
    });
  } catch { /* best effort — events are not critical */ }
  localEvents = [];
}

async function saveLocalAssistantMessage() {
  if (localAssistantBlocks.length === 0) return;
  // Capture parent before any async operation — activeLeafId should point to the
  // user message saved at the start of sendLocal(). Fall back to localUserMessageId
  // for backward compatibility.
  const parentId = activeLeafId.value || localUserMessageId || undefined;
  try {
    const res = await authFetch(`/api/sessions/${props.sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "assistant", content: localAssistantBlocks, parent_id: parentId }),
    });
    if (res.ok) {
      const data = await res.json();
      setActiveLeafId(data.id);
      fetchTree(props.sessionId);
    }
  } catch { /* best effort */ }
  localAssistantBlocks = [];
  localUserMessageId = null;
}

// --- End Local ACP Agent Functions ---

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
  await fetchCheckpoints();
  nextTick(() => {
    messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight, behavior: "smooth" });
  });

  // Check if local agents are configured
  try {
    const agents = await invoke<Array<{ name: string; agent_type: string; binary_path: string }>>("acp_get_agents");
    configuredAgents.value = agents;
    if (agents.length > 0) {
      localAgentStatus.value = "stopped";
    }
  } catch {
    // Not in Tauri environment or no agents
  }

  // Fetch server providers (available for both local and remote sessions)
  try {
    const result = await apiRequest<{ providers: Array<{ name: string; type: string; default_model: string }>; default_provider: string }>("/api/providers");
    if (result.ok && result.data) {
      serverProviders.value = result.data.providers;
    }
  } catch { /* offline or not available */ }

  await restoreInitialPrompt();

  // Listen for ACP events from Tauri backend
  try {
    acpUnlisten = await listen<{ session_id: string; event: any }>("acp-event", (ev) => {
      if (ev.payload.session_id !== props.sessionId) return;
      handleAcpEvent(ev.payload.event);
    });
  } catch {
    // Not in Tauri environment
  }

  document.addEventListener("click", closeProviderDropdown);
});

onUnmounted(() => {
  if (acpUnlisten) {
    acpUnlisten();
    acpUnlisten = null;
  }
  document.removeEventListener("click", closeProviderDropdown);
  resetPanels();
});

onDeactivated(() => {
  resetPanels();
});

function closeProviderDropdown(_e: MouseEvent) {
  // Provider dropdown is now managed by AgentInput
}

watch(() => props.sessionId, async () => {
  blocks.value = [];
  checkpoints.value = [];
  editingMessageId.value = null;
  editingContent.value = "";
  lastEventId = "";
  reconnectAttempts = 0;
  isStreaming.value = false;
  currentSessionStreaming = false;
  closePanel();
  clearHeartbeatTimer();
  await loadHistory();
  await fetchTree(props.sessionId);
  await fetchCheckpoints();
  await restoreInitialPrompt();
  nextTick(() => {
    messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight });
  });
});

// Retry restoreInitialPrompt when connection becomes ready
watch(isConnected, async (connected) => {
  if (connected) await restoreInitialPrompt();
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

function scrollToLastUserMessage() {
  if (!messagesEl.value) return;
  const userBlocks = messagesEl.value.querySelectorAll('.user-block');
  const lastUser = userBlocks[userBlocks.length - 1] as HTMLElement | undefined;
  if (lastUser) {
    const containerTop = messagesEl.value.getBoundingClientRect().top;
    const elTop = lastUser.getBoundingClientRect().top;
    const offset = messagesEl.value.scrollTop + (elTop - containerTop);
    messagesEl.value.scrollTo({ top: offset, behavior: "smooth" });
  }
}

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
  <div class="flex h-full overflow-hidden">
    <div class="flex flex-col flex-1 h-full overflow-hidden">
    <AgentHeader
      :title="sessionTitle"
      :work-dir="sessionWorkDir"
      :show-work-dir="false"
      @back="goBack()"
      @update:title="handleUpdateTitle"
    >
      <template #badges>
        <span class="env-tag" :class="sessionEnvironment">{{ sessionEnvironment === 'local' ? 'Local' : 'Remote' }}</span>
        <template v-if="isEditingWorkDir">
          <div class="workdir-edit">
            <FolderPicker v-model="editWorkDir" />
            <button class="title-action-btn confirm" @click="confirmEditWorkDir" aria-label="Confirm work dir">&#10003;</button>
            <button class="title-action-btn cancel" @click="cancelEditWorkDir" aria-label="Cancel edit">&#10005;</button>
          </div>
        </template>
        <span v-else-if="displayDir" class="context-dir" @click="startEditWorkDir">{{ displayDir }}</span>
        <span
          v-if="sessionEnvironment === 'local'"
          class="agent-status"
          :class="[localAgentStatus, { clickable: localAgentStatus === 'not_configured' }]"
          @click="localAgentStatus === 'not_configured' && (navigateTo('agent-settings'))"
        >
          {{ localAgentStatus === 'running' ? 'Running' : localAgentStatus === 'stopped' ? 'Stopped' : 'Not Configured' }}
        </span>
        <span v-if="activeApplyChangeId" class="apply-indicator">Applying Change</span>
      </template>
      <template #actions>
        <button
          class="new-session-btn"
          :disabled="isCreatingSession"
          @click="startSessionFromCurrentDir"
          title="使用当前目录新建会话"
          aria-label="使用当前目录新建会话"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14"/><path d="M5 12h14"/>
          </svg>
          <span>{{ isCreatingSession ? '创建中' : '新会话' }}</span>
        </button>
        <button
          v-if="sessionEnvironment === 'local'"
          class="settings-icon-btn"
          @click="navigateTo('agent-settings')"
          aria-label="Local Agent Settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </template>
    </AgentHeader>

    <!-- Artifact Review Panel -->
    <ArtifactReview
      v-if="reviewingChangeId"
      :change-id="reviewingChangeId"
      @confirmed="handleReviewConfirmed"
      @close="reviewingChangeId = null"
    />

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
              <div class="user-content-body">
                <pre v-if="item.content" class="whitespace-pre-wrap text-[13px] leading-relaxed font-medium" style="color: var(--color-text-primary)">{{ item.content }}</pre>
                <div v-if="item.images && item.images.length > 0" class="user-images">
                  <img v-for="(img, imgIdx) in item.images" :key="imgIdx" :src="`data:${img.media_type};base64,${img.data}`" alt="User uploaded image" class="user-image-thumb" />
                </div>
              </div>
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
              <button
                v-if="!isStreaming && item.messageId && getCheckpointForMessage(item.messageId)"
                class="edit-btn rewind-btn"
                :disabled="rewindingTo !== null"
                @click="handleRewind(getCheckpointForMessage(item.messageId!)!)"
                aria-label="Rewind to this point"
                title="回退到此消息时的状态"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="1 4 1 10 7 10"/>
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                </svg>
              </button>
            </div>
          </div>
          <div v-else-if="item.kind === 'text'" class="agent-block">
            <div class="markdown-body" v-html="renderMarkdown(item.content)"></div>
          </div>
          <div v-else-if="item.kind === 'structured' && item.cardType === 'result'" class="structured-card">
            <div class="structured-card-title">{{ item.data.title }}</div>
            <div v-for="(section, si) in item.data.sections" :key="si" class="structured-card-section">
              <div class="structured-card-heading">{{ section.heading }}</div>
              <ul class="structured-card-items">
                <li v-for="(it, ii) in section.items" :key="ii">{{ it }}</li>
              </ul>
            </div>
          </div>
          <div v-else-if="item.kind === 'structured' && item.cardType === 'ask'" class="ask-card">
            <div class="ask-card-tabs" v-if="item.data.questions && item.data.questions.length > 1">
              <button
                v-for="(q, qi) in item.data.questions"
                :key="qi"
                class="ask-card-tab"
                :class="{ active: (item.data._activeTab || 0) === qi }"
                type="button"
                @click="item.data._activeTab = qi"
              ><span class="ask-card-tab-dot" :class="{ answered: q.multiSelect ? (q._selected || []).length > 0 : (q._selected || (q._customMode && q._customAnswer?.trim())) }"></span>{{ q.header || `问题 ${qi + 1}` }}</button>
            </div>
            <div class="ask-card-body">
              <div class="ask-card-question">{{ item.data.questions[item.data._activeTab || 0].question }}</div>
              <div class="ask-card-options">
                <button
                  v-for="(opt, oi) in item.data.questions[item.data._activeTab || 0].options"
                  :key="oi"
                  type="button"
                  class="ask-card-option"
                  :class="{ selected: item.data.questions[item.data._activeTab || 0].multiSelect
                    ? (item.data.questions[item.data._activeTab || 0]._selected || []).includes(opt.label || opt)
                    : item.data.questions[item.data._activeTab || 0]._selected === (opt.label || opt) }"
                  :disabled="item.data._answered || isStreaming"
                  @click="selectStructuredAskOption(item, item.data._activeTab || 0, opt.label || opt)"
                >
                  <span>{{ opt.label || opt }}</span>
                  <span v-if="opt.description" class="ask-card-option-desc">{{ opt.description }}</span>
                </button>
                <div v-if="!item.data._answered" class="ask-card-custom">
                  <input
                    v-if="item.data.questions[item.data._activeTab || 0]._customMode"
                    v-model="item.data.questions[item.data._activeTab || 0]._customAnswer"
                    type="text"
                    class="ask-card-custom-input"
                    placeholder="输入自己的答案..."
                    :disabled="isStreaming"
                    @keyup.enter="submitStructuredAsk(item)"
                  />
                  <button
                    v-else
                    type="button"
                    class="ask-card-option"
                    :class="{ selected: item.data.questions[item.data._activeTab || 0]._customMode }"
                    :disabled="isStreaming"
                    @click="startStructuredAskCustom(item, item.data._activeTab || 0)"
                  >自定义答案...</button>
                </div>
              </div>
            </div>
            <div class="ask-card-footer">
              <div v-if="item.data._answered" class="ask-card-answered">已提交</div>
              <div v-else class="ask-card-spacer"></div>
              <button
                v-if="!item.data._answered"
                type="button"
                class="ask-card-submit"
                :disabled="isStreaming || !item.data.questions.every((q: any) => q._customMode ? q._customAnswer?.trim() : q.multiSelect ? (q._selected || []).length > 0 : q._selected)"
                @click="submitStructuredAsk(item)"
              >提交</button>
            </div>
          </div>
          <div v-else-if="item.kind === 'error'" class="error-block">
            <span class="error-message">{{ item.content }}</span>
            <button v-if="item.content.includes('not configured')" class="retry-btn" @click="navigateTo('agent-settings')">Go to Settings</button>
            <button v-else class="retry-btn" @click="resend" :disabled="isStreaming">Retry</button>
          </div>
          <div v-else-if="item.kind === 'tool'" class="tool-block">
            <button @click="toggleToolCall(item.tool)" class="tool-header" :class="{ 'tool-running': item.tool.isRunning, 'tool-error': item.tool.isError && !item.tool.isRunning }">
              <span class="tool-indicator" :class="{ active: item.tool.isRunning }"></span>
              <span class="tool-name">{{ item.tool.name }}</span>
              <span v-if="item.tool.source" class="source-badge" :class="item.tool.source">{{ item.tool.source === 'local' ? 'Local' : 'Server' }}</span>
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
                  <span v-if="tc.source" class="source-badge" :class="tc.source">{{ tc.source === 'local' ? 'Local' : 'Server' }}</span>
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
          <!-- Ask User Options -->
          <div v-else-if="item.kind === 'ask_user'" class="ask-card">
            <div class="ask-card-tabs" v-if="item.questions.length > 1">
              <button
                v-for="(q, qi) in item.questions"
                :key="qi"
                class="ask-card-tab"
                :class="{ active: item.activeTab === qi }"
                type="button"
                @click="item.activeTab = qi"
              ><span class="ask-card-tab-dot" :class="{ answered: q.selected || (q.customMode && q.customAnswer?.trim()) }"></span>{{ q.header || `问题 ${qi + 1}` }}</button>
            </div>
            <div class="ask-card-body">
              <div class="ask-card-question">{{ item.questions[item.activeTab].question }}</div>
              <div class="ask-card-options">
                <button
                  v-for="(opt, oi) in item.questions[item.activeTab].options"
                  :key="oi"
                  type="button"
                  class="ask-card-option"
                  :class="{ selected: item.questions[item.activeTab].selected === opt }"
                  :disabled="item.answered || isStreaming"
                  @click="selectAskUserOption(item, item.activeTab, opt)"
                >{{ opt }}</button>
                <div v-if="!item.answered" class="ask-card-custom">
                  <input
                    v-if="item.questions[item.activeTab].customMode"
                    v-model="item.questions[item.activeTab].customAnswer"
                    type="text"
                    class="ask-card-custom-input"
                    placeholder="输入自己的答案..."
                    :disabled="isStreaming"
                    @keydown.enter.prevent="submitAskUser(item)"
                    @keydown.escape="item.questions[item.activeTab].customMode = false"
                  />
                  <button
                    v-else
                    type="button"
                    class="ask-card-option"
                    :class="{ selected: item.questions[item.activeTab].customMode }"
                    :disabled="isStreaming"
                    @click="startCustomAskUser(item, item.activeTab)"
                  >自定义答案</button>
                </div>
                <!-- Show custom answer as selected when answered with non-option value -->
                <button
                  v-if="item.answered && item.questions[item.activeTab].selected && !item.questions[item.activeTab].options.includes(item.questions[item.activeTab].selected || '')"
                  type="button"
                  class="ask-card-option selected"
                  disabled
                >{{ item.questions[item.activeTab].selected }}</button>
              </div>
            </div>
            <div class="ask-card-footer">
              <div v-if="item.answered" class="ask-card-answered">已提交</div>
              <div v-else class="ask-card-spacer"></div>
              <button
                v-if="!item.answered"
                type="button"
                class="ask-card-submit"
                :disabled="isStreaming || !item.questions.every(q => q.customMode ? q.customAnswer?.trim() : q.selected)"
                @click="submitAskUser(item)"
              >提交</button>
            </div>
          </div>
        </template>
        <div v-if="isStreaming && blocks.length === 0" class="streaming-dot"></div>
        <div class="scroll-spacer"></div>
      </div>
    </div>

    <div v-else class="flex-1"></div>

    <AgentInput
      ref="agentInputRef"
      v-model="input"
      :is-streaming="isStreaming"
      :is-connected="isConnected"
      :is-empty="isEmpty"
      :provider-options="providerOptions"
      :selected-provider="selectedProvider"
      :show-image-upload="true"
      :disable-image-upload="sessionEnvironment === 'local' && selectedProviderSource === 'local'"
      @update:selected-provider="selectedProvider = $event"
      @send="send()"
      @stop="stop()"
      @images-change="handleImagesChange"
    />
    </div>

    <!-- Panel content teleported to AppShell right panel -->
    <Teleport to="#shell-panel-content" v-if="activePanelId">
      <ChangeChatPanel
        v-if="activePanelId === 'changes' && sessionWorkDir"
        :work-dir="sessionWorkDir"
        :session-id="props.sessionId"
        :refresh-key="changesPanelRefreshKey"
        @navigate-session="handleNavigateSession"
        @apply-change="handleApplyChange"
        @review-change="handleReviewChange"
      />
      <SpecPanel v-if="activePanelId === 'specs'" />
      <ConversationOutline
        v-if="activePanelId === 'outline' && treeNodes.length > 0"
        :session-id="props.sessionId"
        :key="'outline-' + props.sessionId"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.context-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border-subtle);
  min-height: 40px;
}
.context-bar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}
.context-bar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
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
.env-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 600;
  text-transform: uppercase;
  margin-left: 6px;
}
.env-tag.local {
  color: var(--color-env-local);
  background: var(--color-env-local-bg);
}
.env-tag.remote {
  color: var(--color-env-remote);
  background: var(--color-env-remote-bg);
}
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
.title-action-btn.confirm { color: var(--color-success); }
.title-action-btn.cancel { color: var(--color-error); }
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
.markdown-body :deep(a) { color: var(--color-accent); text-decoration: none; }
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
  background: var(--color-error-surface);
  border: 1px solid color-mix(in oklch, var(--color-error) 25%, transparent);
  border-radius: 6px;
  margin: 4px 0;
}
.error-message {
  font-size: 13px;
  color: var(--color-error);
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
.input-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 2px 0;
}
.provider-selector {
  position: relative;
}
.provider-current {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text-muted);
  background: var(--color-surface-1);
  border: 1px solid var(--color-border-subtle);
  transition: all 0.12s;
}
.provider-current:hover {
  color: var(--color-text-secondary);
  border-color: var(--color-border);
}
.provider-dropdown {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  min-width: 180px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  z-index: 100;
  padding: 4px;
}
.provider-dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: none;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}
.provider-dropdown-item:hover {
  background: var(--color-surface-2, rgba(255, 255, 255, 0.06));
}
.provider-dropdown-item.active {
  background: var(--color-surface-2, rgba(255, 255, 255, 0.06));
}
.provider-dropdown-name {
  font-size: 12px;
  color: var(--color-text-primary);
  flex: 1;
}
.provider-dropdown-tag {
  font-size: 10px;
  color: var(--color-text-muted);
  opacity: 0.7;
}
.provider-source-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.provider-source-dot.local {
  background: var(--color-env-local);
}
.provider-source-dot.server {
  background: var(--color-env-remote);
}
.input-field {
  width: 100%;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 14px 48px 14px 16px;
  font-size: 13px;
  color: var(--color-text-primary);
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-out-expo);
  resize: none;
  overflow-y: auto;
  line-height: 1.5;
  font-family: inherit;
}
.input-field:focus { border-color: var(--color-accent-dim); }
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
  color: var(--color-surface-0);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s;
}
.send-btn:hover:not(:disabled) { opacity: 0.85; }
.send-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.send-btn.stop-mode { background: var(--color-error); color: var(--color-surface-0); }
.image-upload-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.image-upload-btn:hover:not(:disabled) { color: var(--color-text-primary); background: var(--color-surface-1); }
.image-upload-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.image-preview-row {
  display: flex;
  gap: 8px;
  padding: 8px 0;
  flex-wrap: wrap;
}
.image-preview-item {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--color-border-subtle);
}
.image-preview-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.image-remove-btn {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: oklch(0.13 0.008 220 / 0.7);
  color: var(--color-text-primary);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.user-images {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.user-image-thumb {
  width: 120px;
  max-height: 120px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--color-border-subtle);
}
.user-content-body { flex: 1; min-width: 0; }
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
.rewind-btn:hover { color: var(--color-warning); }
.rewind-btn:disabled { opacity: 0.3; cursor: not-allowed; }
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
  color: var(--color-surface-0);
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

/* Apply change indicator */
.apply-indicator {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-weight: 500;
  color: var(--color-info);
  background: var(--color-info-surface);
}

/* Agent status indicator */
.agent-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-weight: 500;
}
.agent-status.running {
  color: var(--color-success);
  background: var(--color-success-surface);
}
.agent-status.stopped {
  color: var(--color-error);
  background: var(--color-error-surface);
}
.agent-status.not_configured {
  color: var(--color-text-muted);
  background: var(--color-surface-1);
}
.agent-status.clickable {
  cursor: pointer;
}
.agent-status.clickable:hover {
  color: var(--color-accent);
  text-decoration: underline;
}
.new-session-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 4px 10px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 5px;
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s, background 0.12s, opacity 0.12s;
}
.new-session-btn:hover:not(:disabled) {
  color: var(--color-text-primary);
  border-color: var(--color-border);
  background: var(--color-surface-hover, var(--color-surface-2));
}
.new-session-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.new-session-btn svg {
  flex-shrink: 0;
}
.settings-icon-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
}
.settings-icon-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-1);
}

/* Source badge on tool blocks */
.source-badge {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.source-badge.local {
  color: var(--color-env-local);
  background: var(--color-env-local-bg);
}
.source-badge.remote {
  color: var(--color-env-remote);
  background: var(--color-env-remote-bg);
}

/* Ask User Card */
.ask-card {
  margin: 10px 0;
  border: 1px solid color-mix(in oklch, var(--color-accent) 30%, transparent);
  border-radius: 8px;
  background: var(--color-surface-1);
  overflow: hidden;
}
.ask-card-tabs {
  display: flex;
  min-height: 38px;
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-surface-0);
  overflow-x: auto;
}
.ask-card-tab {
  min-width: 96px;
  padding: 9px 14px;
  border: 0;
  border-right: 1px solid var(--color-border-subtle);
  background: transparent;
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: default;
  white-space: nowrap;
}
.ask-card-tab.active {
  color: var(--color-text-primary);
  background: color-mix(in oklch, var(--color-accent) 12%, var(--color-surface-1));
}
.ask-card-tab-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-muted);
  margin-right: 6px;
  vertical-align: middle;
  transition: background 0.2s;
}
.ask-card-tab-dot.answered {
  background: var(--color-accent);
}
.ask-card-body {
  padding: 14px 16px;
}
.ask-card-question {
  color: var(--color-text-primary);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.55;
  margin-bottom: 12px;
}
.ask-card-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ask-card-option {
  width: 100%;
  min-height: 38px;
  padding: 9px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-0);
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.45;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.ask-card-option:hover:not(:disabled) {
  color: var(--color-text-primary);
  border-color: var(--color-accent);
  background: var(--color-surface-2);
}
.ask-card-option.selected {
  color: var(--color-text-primary);
  border-color: var(--color-accent);
  background: color-mix(in oklch, var(--color-accent) 16%, var(--color-surface-1));
}
.ask-card-option:disabled {
  cursor: default;
  opacity: 0.65;
}
.ask-card-option-desc {
  display: block;
  font-size: 12px;
  color: var(--color-text-tertiary);
  font-weight: 400;
  margin-top: 2px;
}
.ask-card-custom {
  min-height: 38px;
}
.ask-card-custom-input {
  width: 100%;
  min-height: 38px;
  padding: 9px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-accent);
  background: var(--color-surface-0);
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;
}
.ask-card-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--color-border-subtle);
  background: color-mix(in oklch, var(--color-surface-0) 75%, transparent);
}
.ask-card-spacer {
  flex: 1;
}
.ask-card-answered {
  flex: 1;
  min-width: 0;
  color: var(--color-text-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ask-card-submit {
  min-width: 82px;
  padding: 7px 16px;
  border: 1px solid var(--color-accent);
  border-radius: 6px;
  background: var(--color-accent);
  color: var(--color-surface-0);
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
}
.ask-card-submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Structured Result Card */
.structured-card {
  margin: 10px 0;
  border: 1px solid color-mix(in oklch, var(--color-accent) 30%, transparent);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  overflow: hidden;
}
.structured-card-title {
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  border-bottom: 1px solid color-mix(in oklch, var(--color-accent) 15%, transparent);
  background: color-mix(in oklch, var(--color-accent) 6%, var(--color-surface-1));
}
.structured-card-section {
  padding: 10px 16px;
}
.structured-card-section + .structured-card-section {
  border-top: 1px solid color-mix(in oklch, var(--color-border) 50%, transparent);
}
.structured-card-heading {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}
.structured-card-items {
  margin: 0;
  padding-left: 18px;
  list-style: disc;
}
.structured-card-items li {
  font-size: 13px;
  color: var(--color-text-primary);
  line-height: 1.6;
}
</style>
