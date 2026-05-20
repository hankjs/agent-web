<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  documentName: string;
  content: string;
  confirmed: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
  edit: [];
}>();

const sections = computed(() => {
  const lines = props.content.split("\n");
  const result: Array<{ title: string; body: string }> = [];
  let current: { title: string; body: string } | null = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) result.push(current);
      current = { title: line.slice(3), body: "" };
    } else if (current) {
      current.body += line + "\n";
    }
  }
  if (current) result.push(current);
  return result;
});
</script>

<template>
  <div class="req-review">
    <div class="req-review-header">
      <span class="req-review-title">需求文档确认</span>
      <span class="req-review-name">{{ documentName }}</span>
    </div>
    <div class="req-review-body">
      <div v-for="(section, i) in sections" :key="i" class="req-review-section">
        <div class="req-review-section-title">{{ section.title }}</div>
        <div class="req-review-section-body">{{ section.body.trim() || '待填充' }}</div>
      </div>
      <div v-if="sections.length === 0" class="req-review-empty">文档内容为空</div>
    </div>
    <div class="req-review-footer">
      <div v-if="confirmed" class="req-review-confirmed">已确认，正在生成任务文档...</div>
      <template v-else>
        <button class="req-review-btn primary" @click="emit('confirm')">确认并生成任务</button>
        <button class="req-review-btn secondary" @click="emit('edit')">继续完善</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.req-review { border: 1px solid color-mix(in oklch, var(--color-accent) 30%, transparent); border-radius: 8px; background: var(--color-surface-1); overflow: hidden; }
.req-review-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--color-border-subtle); }
.req-review-title { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.req-review-name { font-size: 12px; color: var(--color-text-muted); }
.req-review-body { padding: 12px 16px; max-height: 360px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.req-review-section-title { font-size: 13px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 4px; }
.req-review-section-body { font-size: 12px; color: var(--color-text-secondary); line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.req-review-empty { font-size: 12px; color: var(--color-text-muted); font-style: italic; }
.req-review-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--color-border-subtle); background: color-mix(in oklch, var(--color-surface-0) 75%, transparent); }
.req-review-confirmed { font-size: 12px; color: var(--color-success); font-weight: 500; }
.req-review-btn { padding: 7px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
.req-review-btn.primary { border: 1px solid var(--color-accent); background: var(--color-accent); color: var(--color-surface-0); }
.req-review-btn.primary:hover { opacity: 0.9; }
.req-review-btn.secondary { border: 1px solid var(--color-border-subtle); background: var(--color-surface-0); color: var(--color-text-secondary); }
.req-review-btn.secondary:hover { background: var(--color-surface-2); border-color: var(--color-accent); color: var(--color-text-primary); }
</style>
