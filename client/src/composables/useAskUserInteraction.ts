import type { Block } from "../agents/ExploreAgent/types";
import { BlockKind } from "../agents/ExploreAgent/types";
import type { useExploreAgent } from "../agents/ExploreAgent";
import type { Ref } from "vue";

/**
 * 处理 ask_user block 的用户交互：选择选项、提交回答
 */
export function useAskUserInteraction(
    isStreaming: Ref<boolean>,
    exploreAgent: ReturnType<typeof useExploreAgent>
) {
    function selectOption(block: Extract<Block, { kind: BlockKind.AskUser }>, qIdx: number, opt: string) {
        if (block.answered || isStreaming.value) return;
        const q = block.questions[qIdx];
        q.selected = opt;
        q.customMode = false;
    }

    async function submitAskUser(block: Extract<Block, { kind: BlockKind.AskUser }>) {
        if (block.answered) return;
        block.answered = true;
        const answers = block.questions
            .map((q) => (q.customMode ? q.customAnswer || "" : q.selected || ""))
            .join("; ");
        exploreAgent.resume();
        await exploreAgent.handleUserInput(answers);
    }

    return { selectOption, submitAskUser };
}
