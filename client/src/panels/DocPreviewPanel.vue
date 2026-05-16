<script setup lang="ts">
import { computed, ref, nextTick } from "vue";
import type { DocumentSection } from "../agents/ExploreAgent/types";
import type { DocCommit } from "../agents/ExploreAgent/useDocHistory";

const props = defineProps<{
  sections: DocumentSection[];
  canUndo?: boolean;
  canRedo?: boolean;
  currentCommit?: DocCommit | null;
}>();

const emit = defineEmits<{
  undo: [];
  redo: [];
  editSection: [sectionId: string, content: string];
}>();

const editingId = ref<string | null>(null);
const editContent = ref("");

function startEdit(sec: DocumentSection) {
  editingId.value = sec.id;
  editContent.value = sec.content;
  nextTick(() => {
    const el = document.querySelector(".doc-section-editor") as HTMLTextAreaElement | null;
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  });
}

function saveEdit() {
  if (editingId.value && editContent.value !== props.sections.find(s => s.id === editingId.value)?.content) {
    emit("editSection", editingId.value, editContent.value);
  }
  editingId.value = null;
}

function cancelEdit() {
  editingId.value = null;
}

const progress = computed(() => {
  const total = props.sections.length;
  if (total === 0) return { filled: 0, partial: 0, empty: 0, percent: 0 };
  const filled = props.sections.filter(s => s.status === "filled").length;
  const partial = props.sections.filter(s => s.status === "partial").length;
  const empty = total - filled - partial;
  const percent = Math.round(((filled + partial * 0.5) / total) * 100);
  return { filled, partial, empty, percent };
});

const changedSectionIds = computed(() => {
  if (!props.currentCommit?.diffs?.length) return new Set<string>();
  return new Set(props.currentCommit.diffs.map(d => d.sectionId));
});

const sourceLabel = computed(() => {
  if (!props.currentCommit) return "";
  return props.currentCommit.source;
});

const timeLabel = computed(() => {
  if (!props.currentCommit) return "";
  const d = new Date(props.currentCommit.timestamp);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
});

function statusClass(status: string) {
  return `section-status--${status}`;
}
</script>

<template>
  <div class="doc-preview-panel">
    <!-- History toolbar -->
    <div class="doc-history-bar">
      <button class="doc-history-btn" :disabled="!canUndo" @click="emit('undo')" title="撤销">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10h13a4 4 0 0 1 0 8H7"/><polyline points="7 6 3 10 7 14"/></svg>
      </button>
      <button class="doc-history-btn" :disabled="!canRedo" @click="emit('redo')" title="重做">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10H8a4 4 0 0 0 0 8h9"/><polyline points="17 6 21 10 17 14"/></svg>
      </button>
      <span v-if="sourceLabel" class="doc-history-source" :class="'doc-source--' + sourceLabel">{{ sourceLabel }}</span>
      <span v-if="timeLabel" class="doc-history-time">{{ timeLabel }}</span>
    </div>

    <div class="doc-progress-bar">
      <div class="doc-progress-fill" :style="{ width: progress.percent + '%' }"></div>
    </div>
    <div class="doc-progress-label">{{ progress.percent }}% 完成 · {{ progress.filled }} 已填 / {{ progress.partial }} 部分 / {{ progress.empty }} 待填</div>

    <div v-if="sections.length === 0" class="doc-empty">暂无文档结构，开始探索后将自动生成。</div>

    <div v-for="sec in sections" :key="sec.id" class="doc-section" :class="[statusClass(sec.status), { 'doc-section--changed': changedSectionIds.has(sec.id) }]">
      <div class="doc-section-header">
        <span class="doc-section-dot"></span>
        <span class="doc-section-title">{{ sec.title }}</span>
        <span class="doc-section-badge">{{ sec.status === 'filled' ? '已填' : sec.status === 'partial' ? '部分' : '待填' }}</span>
        <button v-if="editingId !== sec.id" class="doc-section-edit-btn" @click="startEdit(sec)" title="编辑">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
      <!-- 编辑模式 -->
      <div v-if="editingId === sec.id" class="doc-section-edit-area">
        <textarea
          class="doc-section-editor"
          v-model="editContent"
          @keydown.ctrl.enter="saveEdit"
          @keydown.meta.enter="saveEdit"
          @keydown.escape="cancelEdit"
          rows="5"
        ></textarea>
        <div class="doc-section-edit-actions">
          <button class="doc-edit-save" @click="saveEdit">保存</button>
          <button class="doc-edit-cancel" @click="cancelEdit">取消</button>
          <span class="doc-edit-hint">Ctrl+Enter 保存 · Esc 取消</span>
        </div>
      </div>
      <!-- 只读模式 -->
      <div v-else-if="sec.content" class="doc-section-content" @dblclick="startEdit(sec)">{{ sec.content }}</div>
      <div v-else class="doc-section-placeholder" @click="startEdit(sec)">点击编辑...</div>
    </div>
  </div>
</template>

<style scoped>
.doc-preview-panel { padding: 16px; display: flex; flex-direction: column; gap: 12px; overflow-x: hidden; min-width: 0; }

.doc-history-bar { display: flex; align-items: center; gap: 6px; }
.doc-history-btn { display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 4px; border: 1px solid var(--color-border-subtle, #333); background: transparent; color: var(--color-text-secondary, #aaa); cursor: pointer; transition: background 0.15s, color 0.15s; }
.doc-history-btn:hover:not(:disabled) { background: var(--color-surface-2, #222); color: var(--color-text-primary, #eee); }
.doc-history-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.doc-history-source { font-size: 10px; padding: 1px 6px; border-radius: 3px; background: rgba(59, 130, 246, 0.12); color: var(--color-accent, #3b82f6); margin-left: auto; }
.doc-source--用户编辑 { background: rgba(250, 204, 21, 0.12); color: #facc15; }
.doc-source--用户回答 { background: rgba(74, 222, 128, 0.12); color: #4ade80; }
.doc-history-time { font-size: 10px; color: var(--color-text-muted, #888); }

.doc-progress-bar { height: 4px; border-radius: 2px; background: var(--color-surface-2, #222); overflow: hidden; }
.doc-progress-fill { height: 100%; border-radius: 2px; background: var(--color-accent, #3b82f6); transition: width 0.3s ease; }
.doc-progress-label { font-size: 11px; color: var(--color-text-muted, #888); }

.doc-empty { font-size: 12px; color: var(--color-text-muted, #888); text-align: center; padding: 24px 0; }

.doc-section { padding: 10px 12px; border-radius: 6px; border: 1px solid var(--color-border-subtle, #333); transition: border-color 0.3s, background 0.3s; }
.doc-section--changed { border-color: #4ade80; background: rgba(74, 222, 128, 0.05); }
.doc-section-header { display: flex; align-items: center; gap: 8px; }
.doc-section-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.doc-section-title { font-size: 13px; font-weight: 500; color: var(--color-text-primary, #eee); flex: 1; }
.doc-section-badge { font-size: 10px; padding: 1px 6px; border-radius: 3px; }

.section-status--filled .doc-section-dot { background: #4ade80; }
.section-status--filled .doc-section-badge { color: #4ade80; background: rgba(74, 222, 128, 0.12); }
.section-status--partial .doc-section-dot { background: #facc15; }
.section-status--partial .doc-section-badge { color: #facc15; background: rgba(250, 204, 21, 0.12); }
.section-status--empty .doc-section-dot { background: #666; }
.section-status--empty .doc-section-badge { color: #888; background: rgba(136, 136, 136, 0.12); }

.doc-section-content { margin-top: 6px; font-size: 12px; line-height: 1.5; color: var(--color-text-secondary, #aaa); white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; cursor: pointer; border-radius: 4px; padding: 4px; transition: background 0.15s; }
.doc-section-content:hover { background: var(--color-surface-2, #222); }

.doc-section-placeholder { margin-top: 6px; font-size: 12px; color: var(--color-text-muted, #666); cursor: pointer; padding: 4px; font-style: italic; }

.doc-section-edit-btn { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 3px; border: none; background: transparent; color: var(--color-text-muted, #666); cursor: pointer; opacity: 0; transition: opacity 0.15s, color 0.15s; }
.doc-section:hover .doc-section-edit-btn { opacity: 1; }
.doc-section-edit-btn:hover { color: var(--color-accent, #3b82f6); }

.doc-section-edit-area { margin-top: 6px; }
.doc-section-editor { width: 100%; min-height: 80px; padding: 8px; border-radius: 4px; border: 1px solid var(--color-accent, #3b82f6); background: var(--color-surface-1, #1a1a1a); color: var(--color-text-primary, #eee); font-size: 12px; line-height: 1.5; resize: vertical; font-family: inherit; outline: none; }
.doc-section-edit-actions { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.doc-edit-save { padding: 3px 10px; border-radius: 4px; border: none; background: var(--color-accent, #3b82f6); color: #fff; font-size: 11px; cursor: pointer; }
.doc-edit-save:hover { opacity: 0.9; }
.doc-edit-cancel { padding: 3px 10px; border-radius: 4px; border: 1px solid var(--color-border-subtle, #333); background: transparent; color: var(--color-text-secondary, #aaa); font-size: 11px; cursor: pointer; }
.doc-edit-cancel:hover { background: var(--color-surface-2, #222); }
.doc-edit-hint { font-size: 10px; color: var(--color-text-muted, #666); margin-left: auto; }
</style>
