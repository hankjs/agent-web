<script setup lang="ts">
import { ref, nextTick, defineExpose } from "vue";
import type { RenderItem, ToolCall } from "../../types/chat";
import type { Checkpoint } from "../../api/checkpoints";
import TextBlock from "./TextBlock.vue";
import ErrorBlock from "./ErrorBlock.vue";
import ToolBlock from "./ToolBlock.vue";
import ToolGroupBlock from "./ToolGroupBlock.vue";
import AskUserCard from "./AskUserCard.vue";
import UserBlock from "./UserBlock.vue";
import StructuredResultCard from "./StructuredResultCard.vue";
import FileChangedBlock from "./FileChangedBlock.vue";
import VerificationBlock from "./VerificationBlock.vue";
import PermissionRequestBlock from "./PermissionRequestBlock.vue";
import RunStatusBlock from "./RunStatusBlock.vue";

const props = defineProps<{
  renderItems: RenderItem[];
  isStreaming: boolean;
  blocksLength: number;
  editingMessageId: string | null;
  editingContent: string;
  rewindingTo: string | null;
  getBranchIndex: (messageId: string) => { current: number; total: number };
  getBranchSiblings: (messageId: string) => Array<{ id: string; role: string }>;
  getCheckpointForMessage: (messageId: string) => Checkpoint | undefined;
  isGroupExpanded: (idx: number, tools: ToolCall[]) => boolean;
}>();

const emit = defineEmits<{
  startEdit: [item: Extract<RenderItem, { kind: "user" }>];
  cancelEdit: [];
  submitEdit: [];
  "update:editingContent": [val: string];
  switchBranch: [siblingId: string];
  rewind: [checkpoint: Checkpoint];
  toggleTool: [tool: ToolCall];
  toggleGroup: [idx: number, tools: ToolCall[]];
  retry: [];
  navigateSettings: [];
  selectAskOption: [item: any, qIdx: number, answer: string];
  startAskCustom: [item: any, qIdx: number];
  submitAsk: [item: any];
  "update:askActiveTab": [item: any, tab: number];
  selectStructuredOption: [item: any, qIdx: number, answer: string];
  startStructuredCustom: [item: any, qIdx: number];
  submitStructured: [item: any];
}>();

const messagesEl = ref<HTMLElement | null>(null);

function scrollToBottom() {
  nextTick(() => {
    messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight, behavior: "smooth" });
  });
}

function scrollToMessageId(id: string | null) {
  if (!id || !messagesEl.value) return;
  const el = messagesEl.value.querySelector(`[data-message-id="${id}"]`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

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

defineExpose({ messagesEl, scrollToBottom, scrollToMessageId, scrollToLastUserMessage });
</script>

<template>
  <div ref="messagesEl" class="flex-1 overflow-y-auto">
    <div class="max-w-[720px] mx-auto px-6 py-8 space-y-6">
      <template v-for="(item, idx) in renderItems" :key="idx">
        <UserBlock
          v-if="item.kind === 'user'"
          :item="item"
          :is-streaming="isStreaming"
          :editing-message-id="editingMessageId"
          :editing-content="editingContent"
          :branch-index="item.messageId ? getBranchIndex(item.messageId) : { current: 0, total: 1 }"
          :branch-siblings="item.messageId ? getBranchSiblings(item.messageId) : []"
          :checkpoint="item.messageId ? getCheckpointForMessage(item.messageId) : undefined"
          :rewinding-to="rewindingTo"
          @start-edit="emit('startEdit', item)"
          @cancel-edit="emit('cancelEdit')"
          @submit-edit="emit('submitEdit')"
          @update:editing-content="emit('update:editingContent', $event)"
          @switch-branch="emit('switchBranch', $event)"
          @rewind="emit('rewind', $event)"
        />
        <TextBlock v-else-if="item.kind === 'text'" :content="item.content" />
        <StructuredResultCard v-else-if="item.kind === 'structured' && item.cardType === 'result'" :data="item.data" />
        <AskUserCard v-else-if="item.kind === 'structured' && item.cardType === 'ask'"
          :questions="item.data.questions.map((q: any) => ({ header: q.header, question: q.question, options: q.options, multiSelect: q.multiSelect, selected: q._selected, customMode: q._customMode, customAnswer: q._customAnswer }))"
          :answered="item.data._answered"
          :active-tab="item.data._activeTab || 0"
          :is-streaming="isStreaming"
          @select-option="(qIdx: number, answer: string) => emit('selectStructuredOption', item, qIdx, answer)"
          @start-custom="(qIdx: number) => emit('startStructuredCustom', item, qIdx)"
          @submit="emit('submitStructured', item)"
          @update:active-tab="item.data._activeTab = $event"
        />
        <ErrorBlock v-else-if="item.kind === 'error'" :content="item.content"
          @retry="item.content.includes('not configured') ? emit('navigateSettings') : emit('retry')" />
        <ToolBlock v-else-if="item.kind === 'tool'" :tool="item.tool" @toggle="emit('toggleTool', $event)" />
        <ToolGroupBlock v-else-if="item.kind === 'tool-group'" :tools="item.tools" :expanded="isGroupExpanded(idx, item.tools)"
          @toggle-group="emit('toggleGroup', idx, item.tools)" @toggle="emit('toggleTool', $event)" />
        <AskUserCard v-else-if="item.kind === 'ask_user'"
          :tool-use-id="item.toolUseId" :questions="item.questions" :answered="item.answered" :active-tab="item.activeTab" :is-streaming="isStreaming"
          @select-option="(qIdx: number, answer: string) => emit('selectAskOption', item, qIdx, answer)"
          @start-custom="(qIdx: number) => emit('startAskCustom', item, qIdx)"
          @submit="emit('submitAsk', item)"
          @update:active-tab="item.activeTab = $event" />
        <FileChangedBlock v-else-if="item.kind === 'file_changed'" :changes="item.changes" />
        <VerificationBlock v-else-if="item.kind === 'verification'"
          :status="item.status" :verdict="item.verdict" :issues="item.issues" />
        <PermissionRequestBlock v-else-if="item.kind === 'permission_request'"
          :tool="item.tool" :risk="item.risk" :reason="item.reason" :answered="item.answered" />
        <RunStatusBlock v-else-if="item.kind === 'run_status'" :status="item.status" :message="item.message" />
      </template>
      <div v-if="isStreaming && blocksLength === 0" class="streaming-dot"></div>
      <div class="scroll-spacer"></div>
    </div>
  </div>
</template>

<style scoped>
.streaming-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-accent); animation: pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
.scroll-spacer { min-height: 60vh; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>
