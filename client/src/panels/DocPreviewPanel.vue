<script setup lang="ts">
import { computed } from "vue";
import type { DocumentSection } from "../agents/ExploreAgent/types";

const props = defineProps<{
  sections: DocumentSection[];
}>();

const progress = computed(() => {
  const total = props.sections.length;
  if (total === 0) return { filled: 0, partial: 0, empty: 0, percent: 0 };
  const filled = props.sections.filter(s => s.status === "filled").length;
  const partial = props.sections.filter(s => s.status === "partial").length;
  const empty = total - filled - partial;
  const percent = Math.round(((filled + partial * 0.5) / total) * 100);
  return { filled, partial, empty, percent };
});

function statusClass(status: string) {
  return `section-status--${status}`;
}
</script>

<template>
  <div class="doc-preview-panel">
    <div class="doc-progress-bar">
      <div class="doc-progress-fill" :style="{ width: progress.percent + '%' }"></div>
    </div>
    <div class="doc-progress-label">{{ progress.percent }}% 完成 · {{ progress.filled }} 已填 / {{ progress.partial }} 部分 / {{ progress.empty }} 待填</div>

    <div v-if="sections.length === 0" class="doc-empty">暂无文档结构，开始探索后将自动生成。</div>

    <div v-for="sec in sections" :key="sec.id" class="doc-section" :class="statusClass(sec.status)">
      <div class="doc-section-header">
        <span class="doc-section-dot"></span>
        <span class="doc-section-title">{{ sec.title }}</span>
        <span class="doc-section-badge">{{ sec.status === 'filled' ? '已填' : sec.status === 'partial' ? '部分' : '待填' }}</span>
      </div>
      <div v-if="sec.content" class="doc-section-content">{{ sec.content }}</div>
    </div>
  </div>
</template>

<style scoped>
.doc-preview-panel { padding: 16px; display: flex; flex-direction: column; gap: 12px; }

.doc-progress-bar { height: 4px; border-radius: 2px; background: var(--color-surface-2, #222); overflow: hidden; }
.doc-progress-fill { height: 100%; border-radius: 2px; background: var(--color-accent, #3b82f6); transition: width 0.3s ease; }
.doc-progress-label { font-size: 11px; color: var(--color-text-muted, #888); }

.doc-empty { font-size: 12px; color: var(--color-text-muted, #888); text-align: center; padding: 24px 0; }

.doc-section { padding: 10px 12px; border-radius: 6px; border: 1px solid var(--color-border-subtle, #333); }
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

.doc-section-content { margin-top: 6px; font-size: 12px; line-height: 1.5; color: var(--color-text-secondary, #aaa); white-space: pre-wrap; }
</style>
