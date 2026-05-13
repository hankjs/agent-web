<script setup lang="ts">
import { ref, nextTick } from "vue";

const props = defineProps<{
  title: string;
  workDir?: string;
  showWorkDir?: boolean;
}>();

const emit = defineEmits<{
  back: [];
  "update:title": [newTitle: string];
}>();

const isEditingTitle = ref(false);
const editTitle = ref("");
const titleInputRef = ref<HTMLInputElement | null>(null);

function startEditTitle() {
  editTitle.value = props.title;
  isEditingTitle.value = true;
  nextTick(() => titleInputRef.value?.focus());
}

function cancelEditTitle() {
  isEditingTitle.value = false;
}

function confirmEditTitle() {
  const newTitle = editTitle.value.trim();
  isEditingTitle.value = false;
  if (newTitle !== props.title) {
    emit("update:title", newTitle);
  }
}
</script>

<template>
  <div class="agent-header">
    <div class="agent-header-left">
      <button class="back-btn" @click="emit('back')" aria-label="Back">&larr;</button>
      <template v-if="isEditingTitle">
        <input
          ref="titleInputRef"
          v-model="editTitle"
          class="title-input"
          @keydown.enter="confirmEditTitle"
          @keydown.escape="cancelEditTitle"
        />
        <button class="title-action-btn confirm" @click="confirmEditTitle" aria-label="Confirm">&#10003;</button>
        <button class="title-action-btn cancel" @click="cancelEditTitle" aria-label="Cancel">&#10005;</button>
      </template>
      <span v-else class="agent-header-title" @click="startEditTitle">{{ title || 'Untitled' }}</span>
      <slot name="badges" />
      <span v-if="showWorkDir !== false && workDir && !isEditingTitle" class="agent-header-workdir">{{ workDir }}</span>
    </div>
    <div class="agent-header-right">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.agent-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--color-border-subtle); }
.agent-header-left { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
.agent-header-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.back-btn { background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 4px; border-radius: 4px; font-size: 16px; line-height: 1; }
.back-btn:hover { color: var(--color-text-primary); background: var(--color-surface-1); }
.agent-header-title { font-size: 13px; font-weight: 500; color: var(--color-text-primary); cursor: pointer; padding: 2px 6px; border-radius: 4px; transition: background 0.12s; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px; }
.agent-header-title:hover { background: var(--color-surface-1); }
.agent-header-workdir { font-family: var(--font-mono); font-size: 12px; color: var(--color-text-muted); padding: 2px 6px; border-radius: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px; }
.title-input { font-size: 13px; font-weight: 500; color: var(--color-text-primary); background: var(--color-surface-1); border: 1px solid var(--color-border); border-radius: 4px; padding: 2px 8px; outline: none; min-width: 120px; max-width: 300px; }
.title-input:focus { border-color: var(--color-accent-dim); }
.title-action-btn { background: none; border: none; font-size: 14px; cursor: pointer; padding: 2px 6px; border-radius: 4px; }
.title-action-btn.confirm { color: var(--color-success, #22c55e); }
.title-action-btn.cancel { color: var(--color-error, #ef4444); }
.title-action-btn:hover { opacity: 0.7; }
</style>
