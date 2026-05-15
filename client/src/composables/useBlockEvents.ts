import { ref, nextTick } from "vue";
import type { Block } from "../agents/ExploreAgent/types";
import { BlockKind } from "../agents/ExploreAgent/types";

/**
 * 管理 block 列表的事件处理：接收新 block、合并更新、滚动
 */
export function useBlockEvents() {
    const blocks = ref<Block[]>([]);
    const isStreaming = ref(false);
    const messagesEl = ref<HTMLElement | null>(null);

    function scrollToBottom() {
        if (messagesEl.value) {
            messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
        }
    }

    function handleThinkingBlock(block: Extract<Block, { kind: BlockKind.Thinking }>) {
        const existing = blocks.value.find((b) => b.kind === BlockKind.Thinking) as typeof block | undefined;
        if (existing) {
            existing.content = block.content;
            return true;
        }
        return false;
    }

    function handleToolBlock(block: Extract<Block, { kind: BlockKind.Tool }>) {
        const lastBlock = blocks.value[blocks.value.length - 1];
        if (lastBlock && lastBlock.kind === BlockKind.ExploreRound) {
            const existing = lastBlock.tools.find((t) => t.id === block.tool.id);
            if (existing) {
                Object.assign(existing, block.tool);
                if (lastBlock.tools.every((t) => !t.isRunning)) {
                    lastBlock.isRunning = false;
                }
            } else {
                lastBlock.tools.push(block.tool);
            }
            return true;
        }
        const existingStandalone = blocks.value.find(
            (b) => b.kind === BlockKind.Tool && b.tool.id === block.tool.id
        ) as typeof block | undefined;
        if (existingStandalone) {
            Object.assign(existingStandalone.tool, block.tool);
            return true;
        }
        return false;
    }

    function clearThinkingIfNeeded(block: Block) {
        const shouldClear =
            block.kind === BlockKind.ExploreRound ||
            block.kind === BlockKind.AskUser ||
            (block.kind === BlockKind.Text && block.content.startsWith("探索完成"));
        if (shouldClear) {
            const idx = blocks.value.findIndex((b) => b.kind === BlockKind.Thinking);
            if (idx >= 0) blocks.value.splice(idx, 1);
        }
    }

    function onBlock(block: Block) {
        if (block.kind === BlockKind.Thinking && handleThinkingBlock(block)) return;
        if (block.kind === BlockKind.Tool && handleToolBlock(block)) return;
        clearThinkingIfNeeded(block);
        blocks.value.push(block);
        nextTick(scrollToBottom);
    }

    function onStreaming(v: boolean) {
        isStreaming.value = v;
    }

    return { blocks, isStreaming, messagesEl, scrollToBottom, onBlock, onStreaming };
}
