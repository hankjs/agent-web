import type { Block, AskUserQuestion } from "../agents/ExploreAgent/types";
import type { useExploreAgent } from "../agents/ExploreAgent";
import { useBlockEvents } from "./useBlockEvents";
import { useAskUserInteraction } from "./useAskUserInteraction";
import { useBlockHistory } from "./useBlockHistory";

export type { Block, AskUserQuestion };

/**
 * 组合入口：聚合 block 事件处理、用户交互、历史加载
 */
export function useAgentBlocks(sessionId: string, exploreAgent: ReturnType<typeof useExploreAgent>) {
    const { blocks, isStreaming, messagesEl, scrollToBottom, onBlock, onStreaming } = useBlockEvents();
    const { selectOption, submitAskUser } = useAskUserInteraction(isStreaming, exploreAgent);
    const { loadHistory } = useBlockHistory(sessionId, blocks, scrollToBottom, exploreAgent);

    return { blocks, isStreaming, messagesEl, scrollToBottom, selectOption, submitAskUser, loadHistory, onBlock, onStreaming };
}
