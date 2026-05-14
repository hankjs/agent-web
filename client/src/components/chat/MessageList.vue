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
        <div v-else-if="item.kind === 'structured' && item.cardType === 'ask'" class="ask-card">
          <div class="ask-card-tabs" v-if="item.data.questions && item.data.questions.length > 1">
            <button v-for="(q, qi) in item.data.questions" :key="qi" class="ask-card-tab" :class="{ active: (item.data._activeTab || 0) === qi }" type="button" @click="item.data._activeTab = qi">
              <span class="ask-card-tab-dot" :class="{ answered: q.multiSelect ? (q._selected || []).length > 0 : (q._selected || (q._customMode && q._customAnswer?.trim())) }"></span>{{ q.header || `问题 ${qi + 1}` }}
            </button>
          </div>
          <div class="ask-card-body">
            <div class="ask-card-question">{{ item.data.questions[item.data._activeTab || 0].question }}</div>
            <div class="ask-card-options">
              <button v-for="(opt, oi) in item.data.questions[item.data._activeTab || 0].options" :key="oi" type="button" class="ask-card-option"
                :class="{ selected: item.data.questions[item.data._activeTab || 0].multiSelect ? (item.data.questions[item.data._activeTab || 0]._selected || []).includes(opt.label || opt) : item.data.questions[item.data._activeTab || 0]._selected === (opt.label || opt) }"
                :disabled="item.data._answered || isStreaming"
                @click="emit('selectStructuredOption', item, item.data._activeTab || 0, opt.label || opt)">
                <span>{{ opt.label || opt }}</span>
                <span v-if="opt.description" class="ask-card-option-desc">{{ opt.description }}</span>
              </button>
              <div v-if="!item.data._answered" class="ask-card-custom">
                <input v-if="item.data.questions[item.data._activeTab || 0]._customMode" v-model="item.data.questions[item.data._activeTab || 0]._customAnswer" type="text" class="ask-card-custom-input" placeholder="输入自己的答案..." :disabled="isStreaming" @keyup.enter="emit('submitStructured', item)" />
                <button v-else type="button" class="ask-card-option" :disabled="isStreaming" @click="emit('startStructuredCustom', item, item.data._activeTab || 0)">自定义答案...</button>
              </div>
            </div>
          </div>
          <div class="ask-card-footer">
            <div v-if="item.data._answered" class="ask-card-answered">已提交</div>
            <div v-else class="ask-card-spacer"></div>
            <button v-if="!item.data._answered" type="button" class="ask-card-submit"
              :disabled="isStreaming || !item.data.questions.every((q: any) => q._customMode ? q._customAnswer?.trim() : q.multiSelect ? (q._selected || []).length > 0 : q._selected)"
              @click="emit('submitStructured', item)">提交</button>
          </div>
        </div>
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
/* Structured ask card styles (inline since it's rendered directly) */
.ask-card { margin: 10px 0; border: 1px solid color-mix(in oklch, var(--color-accent) 30%, transparent); border-radius: 8px; background: var(--color-surface-1); overflow: hidden; }
.ask-card-tabs { display: flex; min-height: 38px; border-bottom: 1px solid var(--color-border-subtle); background: var(--color-surface-0); overflow-x: auto; }
.ask-card-tab { min-width: 96px; padding: 9px 14px; border: 0; border-right: 1px solid var(--color-border-subtle); background: transparent; color: var(--color-text-muted); font-size: 12px; font-weight: 600; cursor: default; white-space: nowrap; }
.ask-card-tab.active { color: var(--color-text-primary); background: color-mix(in oklch, var(--color-accent) 12%, var(--color-surface-1)); }
.ask-card-tab-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--color-text-muted); margin-right: 6px; vertical-align: middle; }
.ask-card-tab-dot.answered { background: var(--color-accent); }
.ask-card-body { padding: 14px 16px; }
.ask-card-question { color: var(--color-text-primary); font-size: 14px; font-weight: 600; line-height: 1.55; margin-bottom: 12px; }
.ask-card-options { display: flex; flex-direction: column; gap: 8px; }
.ask-card-option { width: 100%; min-height: 38px; padding: 9px 12px; border-radius: 6px; border: 1px solid var(--color-border-subtle); background: var(--color-surface-0); color: var(--color-text-secondary); font-size: 13px; line-height: 1.45; text-align: left; cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s; }
.ask-card-option:hover:not(:disabled) { color: var(--color-text-primary); border-color: var(--color-accent); background: var(--color-surface-2); }
.ask-card-option.selected { color: var(--color-text-primary); border-color: var(--color-accent); background: color-mix(in oklch, var(--color-accent) 16%, var(--color-surface-1)); }
.ask-card-option:disabled { cursor: default; opacity: 0.65; }
.ask-card-option-desc { display: block; font-size: 12px; color: var(--color-text-tertiary); font-weight: 400; margin-top: 2px; }
.ask-card-custom { min-height: 38px; }
.ask-card-custom-input { width: 100%; min-height: 38px; padding: 9px 12px; border-radius: 6px; border: 1px solid var(--color-accent); background: var(--color-surface-0); color: var(--color-text-primary); font-size: 13px; outline: none; }
.ask-card-footer { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--color-border-subtle); background: color-mix(in oklch, var(--color-surface-0) 75%, transparent); }
.ask-card-spacer { flex: 1; }
.ask-card-answered { flex: 1; min-width: 0; color: var(--color-text-muted); font-size: 12px; }
.ask-card-submit { min-width: 82px; padding: 7px 16px; border: 1px solid var(--color-accent); border-radius: 6px; background: var(--color-accent); color: var(--color-surface-0); font-size: 13px; font-weight: 650; cursor: pointer; }
.ask-card-submit:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
