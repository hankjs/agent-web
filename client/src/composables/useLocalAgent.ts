import { ref, computed, watch, nextTick, type Ref, type ComputedRef } from "vue";
import { ChatBlockKind, type Block, type ToolCall, type AskUserQuestion } from "../types/chat";
import { authFetch } from "./useSession";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface UseLocalAgentOptions {
  blocks: Ref<Block[]>;
  sessionId: Ref<string>;
  isStreaming: Ref<boolean>;
  messagesEl: Ref<HTMLElement | null>;
  collapseFinishedToolGroups: () => void;
  activeLeafId: Ref<string | null>;
  setActiveLeafId: (id: string) => void;
  fetchTree: (sessionId: string) => Promise<void>;
  currentSession: Ref<any> | ComputedRef<any>;
}

export function useLocalAgent(options: UseLocalAgentOptions) {
  const { blocks, sessionId, isStreaming, messagesEl, collapseFinishedToolGroups, activeLeafId, setActiveLeafId, fetchTree, currentSession } = options;

  const configuredAgents = ref<Array<{ name: string; agent_type: string; binary_path: string }>>([]);
  const serverProviders = ref<Array<{ name: string; type: string; default_model: string }>>([]);
  const localAgentStatus = ref<"running" | "stopped" | "not_configured">("not_configured");
  const selectedProvider = ref("");

  const sessionEnvironment = computed(() => currentSession.value?.environment || "remote");

  const providerOptions = computed(() => {
    const opts: Array<{ name: string; key: string; source: "local" | "server" }> = [];
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

  watch(providerOptions, (opts) => {
    if (opts.length > 0 && !opts.find(o => o.key === selectedProvider.value)) {
      selectedProvider.value = opts[0].key;
    }
  }, { immediate: true });

  const selectedProviderSource = computed<"local" | "server">(() => {
    const opt = providerOptions.value.find(o => o.key === selectedProvider.value);
    return opt?.source || "local";
  });
  const selectedProviderName = computed<string>(() => {
    const opt = providerOptions.value.find(o => o.key === selectedProvider.value);
    return opt?.name || "";
  });
  const localAgentName = computed<string>(() => selectedProviderName.value);

  watch(selectedProvider, async (_newVal, oldVal) => {
    if (localAgentStatus.value === "running") {
      const oldOpt = providerOptions.value.find(o => o.key === oldVal);
      if (oldOpt?.source === "local") {
        try { await invoke("acp_stop", { sessionId: sessionId.value }); } catch { /* ignore */ }
        localAgentStatus.value = "stopped";
      }
    }
  });

  let acpUnlisten: UnlistenFn | null = null;
  let localEvents: Array<{ event_type: string; agent_type: string; payload: any }> = [];
  let localUserMessageId: string | null = null;
  let localAssistantBlocks: Array<any> = [];

  function scrollToBottom() {
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

  async function handleAcpEvent(event: any) {
    const eventType = event.type;
    localEvents.push({ event_type: eventType, agent_type: localAgentName.value, payload: event });
    switch (eventType) {
      case "text_delta": {
        const last = blocks.value[blocks.value.length - 1];
        if (last && last.kind === "text") {
          last.content += event.content;
          const lastAcc = localAssistantBlocks[localAssistantBlocks.length - 1];
          if (lastAcc && lastAcc.type === "text") { lastAcc.text += event.content; }
          else { localAssistantBlocks.push({ type: "text", text: event.content }); }
        } else {
          collapseFinishedToolGroups();
          blocks.value.push({ kind: ChatBlockKind.Text, content: event.content });
          localAssistantBlocks.push({ type: "text", text: event.content });
        }
        break;
      }
      case "tool_use": {
        if (event.tool_name === "AskUserQuestion") {
          const inputData = typeof event.input === "string" ? JSON.parse(event.input) : event.input;
          const rawQuestions = inputData.questions || [];
          if (rawQuestions.length > 0) {
            const questions: AskUserQuestion[] = rawQuestions.map((q: any) => ({
              header: q.header || "", question: q.question || "",
              options: (q.options || []).map((o: any) => o.label || o),
              selected: undefined, customMode: false, customAnswer: "",
            }));
            blocks.value.push({ kind: ChatBlockKind.AskUser, toolUseId: event.tool_call_id || "", questions, answered: false, activeTab: 0 });
          }
          localAssistantBlocks.push({ type: "tool_use", id: event.tool_call_id, name: event.tool_name, input: event.input });
          break;
        }
        blocks.value.push({
          kind: ChatBlockKind.Tool,
          tool: { id: event.tool_call_id, name: event.tool_name, input: typeof event.input === "string" ? event.input : JSON.stringify(event.input), isRunning: true, expanded: false, source: "local" },
        });
        localAssistantBlocks.push({ type: "tool_use", id: event.tool_call_id, name: event.tool_name, input: event.input });
        break;
      }
      case "tool_result": {
        for (let i = blocks.value.length - 1; i >= 0; i--) {
          const b = blocks.value[i];
          if (b.kind === ChatBlockKind.Tool && b.tool.id === event.tool_call_id) {
            b.tool.result = typeof event.output === "string" ? event.output : JSON.stringify(event.output);
            b.tool.isError = event.is_error;
            b.tool.isRunning = false;
            break;
          }
        }
        break;
      }
      case "done": {
        isStreaming.value = false;
        localAgentStatus.value = "stopped";
        await saveLocalAssistantMessage();
        uploadLocalEvents();
        break;
      }
      case "error": {
        blocks.value.push({ kind: ChatBlockKind.Error, content: event.message });
        isStreaming.value = false;
        localAgentStatus.value = "stopped";
        break;
      }
    }
    scrollToBottom();
  }

  async function sendLocal(content: string) {
    if (!content.trim() || isStreaming.value) return;
    if (!localAgentName.value) {
      blocks.value.push({ kind: ChatBlockKind.Error, content: "本地 Agent 未配置，请在设置中配置 Agent。" });
      return;
    }
    blocks.value.push({ kind: ChatBlockKind.User, content });
    isStreaming.value = true;
    localEvents = [];
    localAssistantBlocks = [];
    localUserMessageId = null;

    try {
      const userContent = [{ type: "text", text: content }];
      const parentId = activeLeafId.value || undefined;
      const res = await authFetch(`/api/sessions/${sessionId.value}/messages`, {
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

    localEvents.push({ event_type: "user_message", agent_type: localAgentName.value, payload: { text: content } });

    try {
      if (localAgentStatus.value !== "running") {
        const workDir = currentSession.value?.work_dir || ".";
        await invoke("acp_new_session", { agentName: localAgentName.value, workDir, sessionId: sessionId.value });
        localAgentStatus.value = "running";
      }
      await invoke("acp_prompt", { sessionId: sessionId.value, message: content });
    } catch (e: any) {
      blocks.value.push({ kind: ChatBlockKind.Error, content: `Local agent error: ${e}` });
      isStreaming.value = false;
    }
  }

  async function stopLocal() {
    try { await invoke("acp_cancel", { sessionId: sessionId.value }); } catch { /* best effort */ }
    isStreaming.value = false;
  }

  async function uploadLocalEvents() {
    if (localEvents.length === 0) return;
    try {
      await authFetch(`/api/sessions/${sessionId.value}/local-events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(localEvents),
      });
    } catch { /* best effort */ }
    localEvents = [];
  }

  async function saveLocalAssistantMessage() {
    if (localAssistantBlocks.length === 0) return;
    const parentId = activeLeafId.value || localUserMessageId || undefined;
    try {
      const res = await authFetch(`/api/sessions/${sessionId.value}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "assistant", content: localAssistantBlocks, parent_id: parentId }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveLeafId(data.id);
        fetchTree(sessionId.value);
      }
    } catch { /* best effort */ }
    localAssistantBlocks = [];
    localUserMessageId = null;
  }

  async function initListeners() {
    try {
      const agents = await invoke<Array<{ name: string; agent_type: string; binary_path: string }>>("acp_get_agents");
      configuredAgents.value = agents;
      if (agents.length > 0) localAgentStatus.value = "stopped";
    } catch { /* Not in Tauri environment */ }

    try {
      acpUnlisten = await listen<{ session_id: string; event: any }>("acp-event", (ev) => {
        if (ev.payload.session_id !== sessionId.value) return;
        handleAcpEvent(ev.payload.event);
      });
    } catch { /* Not in Tauri environment */ }
  }

  function cleanup() {
    if (acpUnlisten) { acpUnlisten(); acpUnlisten = null; }
  }

  return {
    configuredAgents,
    serverProviders,
    localAgentStatus,
    selectedProvider,
    sessionEnvironment,
    providerOptions,
    selectedProviderSource,
    selectedProviderName,
    localAgentName,
    sendLocal,
    stopLocal,
    initListeners,
    cleanup,
  };
}
