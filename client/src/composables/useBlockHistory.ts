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

            // 从所有事件（含 internal）恢复 agent 运行状态
            exploreAgent.restoreAgentState(events);

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
                nextTick(() => { scrollToBottom(); setTimeout(scrollToBottom, 100); });
            }

            // 从本地文件恢复文档面板
            await exploreAgent.restoreDocFromFile();

            // 填充 RequirementReview block 的文档内容（从恢复后的 documentSections 组装）
            for (const block of blocks.value) {
                if (block.kind === BlockKind.RequirementReview && !block.content) {
                    const sections = exploreAgent.state.value.documentSections;
                    if (sections.length > 0) {
                        block.content = sections.map(s => `## ${s.title}\n\n${s.content}`).join("\n\n");
                    }
                }
            }
        } catch (e) {
            console.error("[BlockHistory] loadHistory error:", e);
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
                } else if (p.action === "confirm_requirement") {
                    currentRound = null;
                    // 不在这里恢复 — 由 explore:confirm_requirement 事件恢复
                } else {
                    currentRound = null;
                    // 恢复 PlannerDecision block（ask_user、finalize）
                    if (p.action && p.action !== "read_code") {
                        const actionLabel = p.action === "ask_user" ? "向用户提问" : "完成探索";
                        restored.push({ kind: BlockKind.PlannerDecision, reasoning: p.reasoning || "", action: actionLabel, objective: p.params?.objective, expanded: false });
                    }
                }
                break;
            case "explore:confirm_requirement" as any:
                currentRound = null;
                {
                    const evPos = userEvents.indexOf(ev);
                    const hasTaskReviewOrComplete = userEvents.slice(evPos + 1).some(
                        (e) => e.event_type === ExploreEvent.Complete || e.event_type === ("explore:task_review" as any)
                    );
                    restored.push({
                        kind: BlockKind.RequirementReview,
                        documentName: p.title || "",
                        content: "",
                        confirmed: hasTaskReviewOrComplete,
                    });
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
                // 过滤掉内部运行时错误（如旧版代码 bug 产生的错误），不展示给用户
                if (p.error && /tc\.input\.\w+.*is (not a function|undefined)/.test(p.error)) break;
                restored.push({ kind: BlockKind.Error, content: p.error || "未知错误" });
                break;
            case ExploreEvent.Question:
                currentRound = null;
                if (p.questions) {
                    const rawQuestions = Array.isArray(p.questions) ? p.questions : [];
                    const questions = rawQuestions.map((q: any) => ({
                        header: q.header || "",
                        question: q.question || "",
                        options: Array.isArray(q.options) ? q.options.map((o: any) => (typeof o === "string" ? { label: o } : o)) : [],
                    }));
                    const qPos = userEvents.indexOf(ev);
                    const nextAnswerIdx = answerIndices.find((aIdx) => aIdx > qPos);
                    const hasAnswerAfter = nextAnswerIdx !== undefined;
                    // 从 Answer 事件中恢复用户选中的选项
                    if (hasAnswerAfter) {
                        const answerEv = userEvents[nextAnswerIdx];
                        const ap = typeof answerEv.payload === "string" ? JSON.parse(answerEv.payload) : answerEv.payload;
                        const answers = (ap.content || "").split("; ");
                        questions.forEach((q: any, i: number) => {
                            if (answers[i]) q.selected = answers[i];
                        });
                    }
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
            case "explore:task_review" as any:
                currentRound = null;
                {
                    const evPos = userEvents.indexOf(ev);
                    const hasCompleteAfter = userEvents.slice(evPos + 1).some(
                        (e) => e.event_type === ExploreEvent.Complete
                    );
                    restored.push({
                        kind: BlockKind.TaskReview,
                        title: p.title || "",
                        tasks: Array.isArray(p.tasks) ? p.tasks : [],
                        confirmed: hasCompleteAfter,
                    });
                }
                break;
        }
    }
    return restored;
}
