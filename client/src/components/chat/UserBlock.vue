<script setup lang="ts">
import type { RenderItem } from "../../types/chat";
import type { Checkpoint } from "../../api/checkpoints";

const props = defineProps<{
  item: Extract<RenderItem, { kind: "user" }>;
  isStreaming: boolean;
  editingMessageId: string | null;
  editingContent: string;
  branchIndex: { current: number; total: number };
  branchSiblings: Array<{ id: string; role: string }>;
  checkpoint?: Checkpoint;
  rewindingTo: string | null;
}>();

const emit = defineEmits<{
  startEdit: [];
  cancelEdit: [];
  submitEdit: [];
  "update:editingContent": [val: string];
  switchBranch: [siblingId: string];
  rewind: [checkpoint: Checkpoint];
}>();
</script>

<template>
  <div class="user-block" :data-message-id="item.messageId">
    <!-- Branch navigation -->
    <div v-if="item.messageId && branchIndex.total > 1" class="branch-nav">
      <button class="branch-arrow" :disabled="branchIndex.current === 0"
        @click="emit('switchBranch', branchSiblings.filter(s => s.role === 'user')[branchIndex.current - 1].id)"
        aria-label="Previous branch">&lsaquo;</button>
      <span class="branch-indicator">{{ branchIndex.current + 1 }}/{{ branchIndex.total }}</span>
      <button class="branch-arrow" :disabled="branchIndex.current === branchIndex.total - 1"
        @click="emit('switchBranch', branchSiblings.filter(s => s.role === 'user')[branchIndex.current + 1].id)"
        aria-label="Next branch">&rsaquo;</button>
    </div>
    <!-- Edit mode -->
    <div v-if="editingMessageId === item.messageId" class="edit-inline">
      <textarea
        :value="editingContent"
        @input="emit('update:editingContent', ($event.target as HTMLTextAreaElement).value)"
        class="edit-textarea"
        @keydown.enter.exact.prevent="emit('submitEdit')"
        @keydown.escape="emit('cancelEdit')"
        rows="3"
      ></textarea>
      <div class="edit-actions">
        <button class="edit-submit" @click="emit('submitEdit')">Submit</button>
        <button class="edit-cancel" @click="emit('cancelEdit')">Cancel</button>
      </div>
    </div>
    <!-- Normal display -->
    <div v-else class="user-content-row">
      <div class="user-content-body">
        <pre v-if="item.content" class="whitespace-pre-wrap text-[13px] leading-relaxed font-medium" style="color: var(--color-text-primary)">{{ item.content }}</pre>
        <div v-if="item.images && item.images.length > 0" class="user-images">
          <img v-for="(img, imgIdx) in item.images" :key="imgIdx" :src="`data:${img.media_type};base64,${img.data}`" alt="User uploaded image" class="user-image-thumb" />
        </div>
      </div>
      <button v-if="!isStreaming" class="edit-btn" @click="emit('startEdit')" aria-label="Edit message">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      <button v-if="!isStreaming && checkpoint" class="edit-btn rewind-btn" :disabled="rewindingTo !== null"
        @click="emit('rewind', checkpoint!)" aria-label="Rewind to this point" title="回退到此消息时的状态">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.user-block { padding-top: 8px; padding-bottom: 4px; border-top: 1px solid var(--color-border); }
.user-content-row { display: flex; align-items: flex-start; gap: 8px; position: relative; }
.user-content-row pre { flex: 1; min-width: 0; }
.user-content-body { flex: 1; min-width: 0; }
.user-images { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.user-image-thumb { width: 120px; max-height: 120px; object-fit: cover; border-radius: 8px; border: 1px solid var(--color-border-subtle); }
.edit-btn { opacity: 0; flex-shrink: 0; background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 4px; border-radius: 4px; transition: opacity 0.15s, color 0.15s; margin-top: 2px; }
.user-block:hover .edit-btn { opacity: 1; }
.edit-btn:hover { color: var(--color-text-primary); }
.rewind-btn:hover { color: var(--color-warning); }
.rewind-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.edit-inline { margin-top: 4px; }
.edit-textarea { width: 100%; background: var(--color-surface-1); border: 1px solid var(--color-border); border-radius: 6px; padding: 10px 14px; font-size: 14px; color: var(--color-text-primary); font-family: inherit; resize: vertical; outline: none; line-height: 1.5; }
.edit-textarea:focus { border-color: var(--color-accent-dim); }
.edit-actions { display: flex; gap: 8px; margin-top: 8px; justify-content: flex-end; }
.edit-submit { padding: 5px 14px; font-size: 12px; font-weight: 500; border: none; border-radius: 4px; background: var(--color-text-primary); color: var(--color-surface-0); cursor: pointer; }
.edit-submit:hover { opacity: 0.85; }
.edit-cancel { padding: 5px 14px; font-size: 12px; font-weight: 500; border: 1px solid var(--color-border); border-radius: 4px; background: none; color: var(--color-text-muted); cursor: pointer; }
.edit-cancel:hover { color: var(--color-text-primary); }
.branch-nav { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
.branch-arrow { background: none; border: none; color: var(--color-text-muted); font-size: 16px; cursor: pointer; padding: 0 4px; border-radius: 3px; line-height: 1; }
.branch-arrow:hover:not(:disabled) { color: var(--color-text-primary); background: var(--color-surface-1); }
.branch-arrow:disabled { opacity: 0.3; cursor: not-allowed; }
.branch-indicator { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-muted); }
</style>
