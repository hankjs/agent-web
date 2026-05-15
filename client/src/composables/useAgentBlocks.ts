import { ref, nextTick } from "vue";
import { authFetch } from "./useSession";
import type { Block, AskUserQuestion } from "../agents/ExploreAgent/types";
import type { useExploreAgent } from "../agents/ExploreAgent";

export type { Block, AskUserQuestion };

export function useAgentBlocks(sessionId: string, exploreAgent: ReturnType<typeof useExploreAgent>) {
  const blocks = ref<Block[]>([]);
  const isStreaming = ref(false);
  const messagesEl = ref<HTMLElement | null>(null);

  function scrollToBottom() {
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
    }
  }

  function onBlock(block: Block) {
    if (block.kind === "thinking") {
      const existing = blocks.value.find(b => b.kind === "thinking") as Extract<Block, { kind: "thinking" }> | undefined;
      if (existing) {
        existing.content = block.content;
        return;
      }
    }
    if (block.kind === "tool") {
      const lastBlock = blocks.value[blocks.value.length - 1];
      if (lastBlock && lastBlock.kind === "explore_round") {
        const existing = lastBlock.tools.find(t => t.id === block.tool.id);
        if (existing) {
          Object.assign(existing, block.tool);
          if (lastBlock.tools.every(t => !t.isRunning)) {
            lastBlock.isRunning = false;
          }
        } else {
          lastBlock.tools.push(block.tool);
        }
        return;
      }
      const existingStandalone = blocks.value.find(
        (b) => b.kind === "tool" && b.tool.id === block.tool.id
      ) as Extract<Block, { kind: "tool" }> | undefined;
      if (existingStandalone) {
        Object.assign(existingStandalone.tool, block.tool);
        return;
      }
    }
    if (block.kind === "explore_round" || block.kind === "ask_user" || (block.kind === "text" && block.content.startsWith("探索完成"))) {
      const thinkingIdx = blocks.value.findIndex(b => b.kind === "thinking");
      if (thinkingIdx >= 0) {
        blocks.value.splice(thinkingIdx, 1);
      }
    }
    blocks.value.push(block);
    nextTick(scrollToBottom);
  }

  function onStreaming(v: boolean) {
    isStreaming.value = v;
  }

  function selectOption(block: Extract<Block, { kind: "ask_user" }>, qIdx: number, opt: string) {
    if (block.answered || isStreaming.value) return;
    const q = block.questions[qIdx];
    q.selected = opt;
    q.customMode = false;
  }

  async function submitAskUser(block: Extract<Block, { kind: "ask_user" }>) {
    if (block.answered) return;
    block.answered = true;
    const answers = block.questions.map(q => q.customMode ? (q.customAnswer || "") : (q.selected || "")).join("; ");
    exploreAgent.resume();
    await exploreAgent.handleUserInput(answers);
  }

  async function loadHistory() {
    try {
      const res = await authFetch(`/api/sessions/${sessionId}/events`);
      if (!res.ok) return;
      const json = await res.json();
      const events: Array<{ event_type: string; payload: any; source: string }> = json.data || json;
      const userEvents = events.filter((ev: any) => ev.source !== "remote");
      const questionIndices: number[] = [];
      const answerIndices: number[] = [];
      userEvents.forEach((ev: any, idx: number) => {
        if (ev.event_type === "explore:question") questionIndices.push(idx);
        if (ev.event_type === "explore:answer") answerIndices.push(idx);
      });
      const restored: Block[] = [];
      let currentRound: Extract<Block, { kind: "explore_round" }> | null = null;

      for (const ev of userEvents) {
        const p = typeof ev.payload === "string" ? JSON.parse(ev.payload) : ev.payload;
        switch (ev.event_type) {
          case "explore:answer":
            currentRound = null;
            if (p.content) restored.push({ kind: "user", content: p.content });
            break;
          case "explore:action":
            if (p.action === "read_code" && p.params?.objective) {
              currentRound = { kind: "explore_round", objective: p.params.objective, reasoning: p.reasoning, tools: [], expanded: false, isRunning: false };
              restored.push(currentRound);
            } else {
              currentRound = null;
            }
            break;
          case "explore:tool_call":
            if (currentRound && p.tool_name) {
              currentRound.tools.push({ id: p.tool_name + "_" + (currentRound.tools.length), name: p.tool_name, input: p.input ? JSON.stringify(p.input) : undefined, isRunning: false, expanded: false });
            }
            break;
          case "explore:tool_result":
            if (currentRound && currentRound.tools.length > 0) {
              const lastTool = currentRound.tools[currentRound.tools.length - 1];
              lastTool.result = p.output_preview || "";
              lastTool.isError = p.is_error || false;
            }
            break;
          case "explore:status":
            if (p.message && !p.message.startsWith("正在阅读代码:")) {
              currentRound = null;
              restored.push({ kind: "text", content: p.message });
            }
            break;
          case "explore:error":
            currentRound = null;
            restored.push({ kind: "error", content: p.error || "未知错误" });
            break;
          case "explore:question":
            currentRound = null;
            if (p.questions) {
              const questions = p.questions.map((q: any) => ({
                header: q.header || "",
                question: q.question || "",
                options: (q.options || []).map((o: any) => typeof o === "string" ? o : o.label),
              }));
              const qPos = userEvents.indexOf(ev);
              const hasAnswerAfter = answerIndices.some(aIdx => aIdx > qPos);
              restored.push({ kind: "ask_user", toolUseId: `hist_${Date.now()}_${Math.random()}`, questions, answered: hasAnswerAfter, activeTab: 0 });
            }
            break;
          case "explore:complete":
            currentRound = null;
            if (p.title) restored.push({ kind: "text", content: `探索完成: ${p.title}` });
            break;
        }
      }
      if (restored.length > 0) {
        blocks.value = restored;
        const hasComplete = events.some((ev: any) => ev.event_type === "explore:complete");
        if (hasComplete) {
          exploreAgent.markDone();
        }
        nextTick(scrollToBottom);
      }
    } catch { /* best effort */ }
  }

  return { blocks, isStreaming, messagesEl, scrollToBottom, selectOption, submitAskUser, loadHistory, onBlock, onStreaming };
}
