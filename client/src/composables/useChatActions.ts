import { ref, computed, nextTick, type Ref, type ComputedRef } from "vue";
import type { Block, RenderItem } from "../types/chat";
import { authFetch, apiRequest } from "./useSession";
import { getApplyContext } from "../api/changes";
import { buildApplyPrompt } from "../agents/ChangeAgent";

export interface UseChatActionsOptions {
  blocks: Ref<Block[]>;
  sessionId: Ref<string>;
  isStreaming: Ref<boolean>;
  isConnected: Ref<boolean>;
  renderItems: ComputedRef<RenderItem[]>;
  groupExpanded: Ref<Record<number, boolean>>;
  messagesEl: Ref<HTMLElement | null>;
  input: Ref<string>;
  pendingImages: Ref<Array<{ media_type: string; data: string }>>;
  agentInputRef: Ref<any>;
  sessionEnvironment: ComputedRef<string>;
  selectedProviderSource: ComputedRef<"local" | "server">;
  selectedProviderName: ComputedRef<string>;
  startStream: (body: any) => Promise<void>;
  stopStream: () => Promise<void>;
  sendLocal: (content: string) => Promise<void>;
  stopLocal: () => Promise<void>;
}

export function useChatActions(options: UseChatActionsOptions) {
  const {
    blocks, sessionId, isStreaming, isConnected, renderItems, groupExpanded,
    messagesEl, input, pendingImages, agentInputRef,
    sessionEnvironment, selectedProviderSource, selectedProviderName,
    startStream, stopStream, sendLocal, stopLocal,
  } = options;

  const activeApplyChangeId = ref<string | null>(null);

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

  async function send(parentIdOverride?: string) {
    if (sessionEnvironment.value === "local" && selectedProviderSource.value === "local") {
      return sendLocal(input.value.trim());
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
    nextTick(() => { scrollToLastUserMessage(); });
    isStreaming.value = true;

    const body: any = { content };
    if (images) body.images = images;
    if (parentIdOverride) body.parent_id = parentIdOverride;
    if (sessionEnvironment.value === "local" && selectedProviderSource.value === "server") {
      body.provider = selectedProviderName.value;
    }
    await startStream(body);
  }

  async function sendWithParent(content: string, parentId?: string) {
    if (!content.trim() || !isConnected.value || isStreaming.value) return;
    if (parentId === "root") {
      blocks.value.splice(0);
    } else if (parentId) {
      let cutIdx = -1;
      for (let i = 0; i < blocks.value.length; i++) {
        const b = blocks.value[i];
        if (b.kind === "user" && b.parentId === parentId) { cutIdx = i; break; }
      }
      if (cutIdx >= 0) blocks.value.splice(cutIdx);
    }
    blocks.value.push({ kind: "user", content });
    isStreaming.value = true;
    nextTick(() => { scrollToLastUserMessage(); });

    const body: any = { content };
    if (parentId) body.parent_id = parentId;
    if (sessionEnvironment.value === "local" && selectedProviderSource.value === "server") {
      body.provider = selectedProviderName.value;
    }
    await startStream(body);
  }

  async function stop() {
    if (sessionEnvironment.value === "local" && selectedProviderSource.value === "local") {
      return stopLocal();
    }
    await stopStream();
    const items = renderItems.value;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "tool-group" && item.tools.some((t) => t.isRunning)) {
        groupExpanded.value[i] = true;
        for (const tc of item.tools) { if (tc.isRunning) tc.isRunning = false; }
      } else if (item.kind === "tool" && item.tool.isRunning) {
        item.tool.isRunning = false;
      }
    }
    isStreaming.value = false;
  }

  async function resend() {
    let lastUserIdx = -1;
    for (let i = blocks.value.length - 1; i >= 0; i--) {
      if (blocks.value[i].kind === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx < 0) return;
    const userBlock = blocks.value[lastUserIdx] as { kind: "user"; content: string };
    const content = userBlock.content;

    const messagesBeforeError = blocks.value.slice(0, lastUserIdx);
    let keepCount = 0;
    let i = 0;
    while (i < messagesBeforeError.length) {
      const b = messagesBeforeError[i];
      if (b.kind === "user") { keepCount++; i++; }
      else { keepCount++; i++; while (i < messagesBeforeError.length && messagesBeforeError[i].kind !== "user") i++; }
    }
    try {
      await authFetch(`/api/sessions/${sessionId.value}/messages/truncate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep_count: keepCount }),
      });
    } catch { /* best effort */ }

    blocks.value.splice(lastUserIdx);
    blocks.value.push({ kind: "user", content });
    isStreaming.value = true;
    await startStream({ content });
  }

  function selectAskUserOption(item: Extract<RenderItem, { kind: "ask_user" }>, qIdx: number, answer: string) {
    if (item.answered || isStreaming.value) return;
    const q = item.questions[qIdx];
    if (!q) return;
    q.selected = answer;
    q.customMode = false;
    q.customAnswer = "";
    if (qIdx < item.questions.length - 1) item.activeTab = qIdx + 1;
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
    const answers: string[] = [];
    for (const q of item.questions) {
      const answer = q.customMode ? (q.customAnswer || "").trim() : (q.selected || "").trim();
      if (!answer) return;
      answers.push(answer);
    }
    await answerAskUser(item, answers);
  }

  async function answerAskUser(item: Extract<RenderItem, { kind: "ask_user" }>, answers: string[]) {
    item.answered = true;
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
      if (idx >= 0) arr.splice(idx, 1); else arr.push(answer);
      q._selected = [...arr];
    } else {
      q._selected = answer;
      if (qIdx < item.data.questions.length - 1) item.data._activeTab = qIdx + 1;
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
      if (q._customMode) { const val = (q._customAnswer || "").trim(); if (!val) return; answers.push(val); }
      else if (q.multiSelect) { const arr = q._selected || []; if (arr.length === 0) return; answers.push(arr); }
      else { const val = (q._selected || "").trim(); if (!val) return; answers.push(val); }
    }
    item.data._answered = true;
    const payload = item.data.questions.map((q: any, i: number) => ({ header: q.header || q.question, answer: answers[i] }));
    input.value = JSON.stringify(payload);
    await send();
  }

  async function handleApplyChange(changeId: string, closePanel: () => void, showWarning: (msg: string) => void) {
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
    nextTick(() => scrollToLastUserMessage());
    const body: any = { content, apply_change_id: changeId };
    await startStream(body);
  }

  return {
    activeApplyChangeId,
    send,
    sendWithParent,
    stop,
    resend,
    selectAskUserOption,
    startCustomAskUser,
    submitAskUser,
    selectStructuredAskOption,
    startStructuredAskCustom,
    submitStructuredAsk,
    handleApplyChange,
    scrollToLastUserMessage,
  };
}
