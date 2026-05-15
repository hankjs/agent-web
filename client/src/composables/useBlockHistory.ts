import { nextTick } from "vue";
import type { Ref } from "vue";
import { authFetch } from "./useSession";
import type { Block } from "../agents/ExploreAgent/types";
import { BlockKind, ExploreEvent } from "../agents/ExploreAgent/types";
import type { useExploreAgent } from "../agents/ExploreAgent";

/**
 * 从后端加载历史事件并还原为 Block 列表
 */
export function useBlockHistory(
    sessionId: string,
    blocks: Ref<Block[]>,
    scrollToBottom: () => void,
    exploreAgent: ReturnType<typeof useExploreAgent>
) {
    async function loadHistory() {
        try {
            const res = await authFetch(`/api/sessions/${sessionId}/events`);
            if (!res.ok) return;
            const json = await res.json();
            const events: RawEvent[] = json.data || json;
            const userEvents = events.filter((ev: RawEvent) => ev.source !== "remote" && ev.visibility !== "internal");

            const answerIndices: number[] = [];
            userEvents.forEach((ev: any, idx: number) => {
                if (ev.event_type === ExploreEvent.Answer) answerIndices.push(idx);
            });

            const restored = restoreBlocks(userEvents, answerIndices);

            if (restored.length > 0) {
                blocks.value = restored;
                if (events.some((ev: any) => ev.event_type === ExploreEvent.Complete)) {
                    exploreAgent.markDone();
                }
                nextTick(scrollToBottom);
            }
        } catch {
            /* best effort */
        }
    }

    return { loadHistory };
}

type RawEvent = { event_type: string; payload: any; source: string; visibility?: "user" | "internal" };

function restoreBlocks(userEvents: RawEvent[], answerIndices: number[]): Block[] {
    const restored: Block[] = [];
    let currentRound: Extract<Block, { kind: BlockKind.ExploreRound }> | null = null;

    for (const ev of userEvents) {
        const p = typeof ev.payload === "string" ? JSON.parse(ev.payload) : ev.payload;
        switch (ev.event_type) {
            case ExploreEvent.Answer:
                currentRound = null;
                if (p.content) restored.push({ kind: BlockKind.User, content: p.content });
                break;
            case ExploreEvent.Action:
                if (p.action === "read_code" && p.params?.objective) {
                    currentRound = {
                        kind: BlockKind.ExploreRound,
                        objective: p.params.objective,
                        reasoning: p.reasoning,
                        tools: [],
                        expanded: false,
                        isRunning: false,
                    };
                    restored.push(currentRound);
                } else {
                    currentRound = null;
                }
                break;
            case ExploreEvent.ToolCall:
                if (currentRound && p.tool_name) {
                    currentRound.tools.push({
                        id: p.tool_name + "_" + currentRound.tools.length,
                        name: p.tool_name,
                        input: p.input ? JSON.stringify(p.input) : undefined,
                        isRunning: false,
                        expanded: false,
                    });
                }
                break;
            case ExploreEvent.ToolResult:
                if (currentRound && currentRound.tools.length > 0) {
                    const lastTool = currentRound.tools[currentRound.tools.length - 1];
                    lastTool.result = p.output_preview || "";
                    lastTool.isError = p.is_error || false;
                }
                break;
            case ExploreEvent.Status:
                if (p.message && !p.message.startsWith("正在阅读代码:") && !p.message.startsWith("探索完成:")) {
                    currentRound = null;
                    restored.push({ kind: BlockKind.Text, content: p.message });
                }
                break;
            case ExploreEvent.Error:
                currentRound = null;
                restored.push({ kind: BlockKind.Error, content: p.error || "未知错误" });
                break;
            case ExploreEvent.Question:
                currentRound = null;
                if (p.questions) {
                    const questions = p.questions.map((q: any) => ({
                        header: q.header || "",
                        question: q.question || "",
                        options: (q.options || []).map((o: any) => (typeof o === "string" ? { label: o } : o)),
                    }));
                    const qPos = userEvents.indexOf(ev);
                    const hasAnswerAfter = answerIndices.some((aIdx) => aIdx > qPos);
                    restored.push({
                        kind: BlockKind.AskUser,
                        toolUseId: `hist_${Date.now()}_${Math.random()}`,
                        questions,
                        answered: hasAnswerAfter,
                        activeTab: 0,
                    });
                }
                break;
            case ExploreEvent.Complete:
                currentRound = null;
                if (p.title) restored.push({ kind: BlockKind.Text, content: `探索完成: ${p.title}` });
                break;
        }
    }
    return restored;
}
