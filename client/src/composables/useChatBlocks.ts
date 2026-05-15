import { ref, reactive, computed, type Ref } from "vue";
import { ChatBlockKind, type Block, type RenderItem, type ToolCall, type AskUserQuestion } from "../types/chat";
import { apiRequest } from "./useSession";

export function useChatBlocks(sessionId: Ref<string>, isStreaming: Ref<boolean>) {
  const blocks = ref<Block[]>([]);
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
      if (before.trim()) parts.push({ kind: ChatBlockKind.Text, content: before });
      try {
        const raw = match[2];
        const cardType = match[1];
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
          parts.push({ kind: ChatBlockKind.Structured, cardType, data: structuredAskCache.get(cacheKey) });
        } else {
          const data = JSON.parse(raw);
          parts.push({ kind: ChatBlockKind.Structured, cardType, data });
        }
      } catch {
        parts.push({ kind: ChatBlockKind.Text, content: match[0] });
      }
      lastIndex = match.index + match[0].length;
    }
    const after = content.slice(lastIndex);
    if (after.trim()) parts.push({ kind: ChatBlockKind.Text, content: after });
    return parts;
  }

  const renderItems = computed<RenderItem[]>(() => {
    const items: RenderItem[] = [];
    let i = 0;
    while (i < blocks.value.length) {
      const block = blocks.value[i];
      if (block.kind === ChatBlockKind.Tool) {
        const tools: ToolCall[] = [block.tool];
        let j = i + 1;
        while (j < blocks.value.length && blocks.value[j].kind === ChatBlockKind.Tool) {
          tools.push((blocks.value[j] as { kind: ChatBlockKind.Tool; tool: ToolCall }).tool);
          j++;
        }
        if (tools.length >= 2) {
          items.push({ kind: ChatBlockKind.ToolGroup, tools });
        } else {
          items.push(block);
        }
        i = j;
      } else if (block.kind === ChatBlockKind.AskUser) {
        const prev = items[items.length - 1];
        if (prev && prev.kind === ChatBlockKind.AskUser && prev.questions.length === block.questions.length &&
            prev.questions.every((q, qi) => q.question === block.questions[qi].question)) {
          i++;
        } else {
          items.push(block);
          i++;
        }
      } else if (block.kind === ChatBlockKind.Text && (structuredBlockRegex.lastIndex = 0, structuredBlockRegex.test(block.content))) {
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

  function collapseFinishedToolGroups() {
    const items = renderItems.value;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === ChatBlockKind.ToolGroup && !item.tools.some((t) => t.isRunning)) {
        if (groupExpanded.value[i] === undefined || groupExpanded.value[i]) {
          groupExpanded.value[i] = false;
        }
      }
    }
  }

  async function loadHistory(leafId?: string) {
    try {
      const query = leafId ? `?leaf_id=${leafId}` : "";
      const result = await apiRequest<any[]>(`/api/sessions/${sessionId.value}/messages${query}`);
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
                  if (b.kind === ChatBlockKind.Tool && b.tool.id === block.tool_use_id) {
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
            const askMatch = textContent.match(/^\[([^\]]+)\]([\s\S]*)$/);
            if (askMatch) {
              const matchedId = askMatch[1];
              const answerBody = askMatch[2];
              for (let i = blocks.value.length - 1; i >= 0; i--) {
                const b = blocks.value[i];
                if (b.kind === ChatBlockKind.AskUser && b.toolUseId === matchedId) {
                  b.answered = true;
                  try {
                    const payload = JSON.parse(answerBody) as Array<{ header: string; answer: string }>;
                    for (let qi = 0; qi < b.questions.length && qi < payload.length; qi++) {
                      b.questions[qi].selected = payload[qi].answer;
                    }
                  } catch {
                    const lines = answerBody.split("\n").filter((l: string) => l.trim());
                    for (let qi = 0; qi < b.questions.length && qi < lines.length; qi++) {
                      const colonIdx = lines[qi].indexOf(": ");
                      b.questions[qi].selected = colonIdx >= 0 ? lines[qi].slice(colonIdx + 2) : lines[qi];
                    }
                  }
                  break;
                }
              }
            } else if (textContent || images.length > 0) {
              blocks.value.push({ kind: ChatBlockKind.User, content: textContent, images: images.length > 0 ? images : undefined, messageId: msg.id, parentId: msg.parent_id });
            }
          } else {
            let skipNextText = false;
            for (const block of content) {
              if (block.type === "text" && block.text) {
                if (skipNextText) { skipNextText = false; continue; }
                blocks.value.push({ kind: ChatBlockKind.Text, content: block.text });
              } else if (block.type === "error" && block.text) {
                blocks.value.push({ kind: ChatBlockKind.Error, content: block.text });
              } else if (block.type === "tool_use") {
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
                    blocks.value.push({ kind: ChatBlockKind.AskUser, toolUseId: block.id || "", questions, answered: false, activeTab: 0 });
                  }
                  skipNextText = true;
                } else {
                  blocks.value.push({
                    kind: ChatBlockKind.Tool,
                    tool: { id: block.id, name: block.name, input: typeof block.input === "string" ? block.input : JSON.stringify(block.input), isRunning: false, expanded: false },
                  });
                }
              }
            }
          }
        } catch { /* skip malformed */ }
      }
      return messages;
    } catch { /* offline */ }
  }

  function reset() {
    blocks.value = [];
    groupExpanded.value = {};
  }

  return {
    blocks,
    renderItems,
    groupExpanded,
    isGroupExpanded,
    toggleGroup,
    collapseFinishedToolGroups,
    loadHistory,
    splitTextWithStructured,
    reset,
  };
}


