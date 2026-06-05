<script setup lang="ts">
defineProps<{
  status: "started" | "completed" | "failed" | "cancelled";
  message?: string;
}>();

const label: Record<string, string> = {
  started: "运行中…",
  completed: "已完成",
  failed: "运行失败",
  cancelled: "已取消",
};
const cls: Record<string, string> = {
  started: "rs-started",
  completed: "rs-done",
  failed: "rs-fail",
  cancelled: "rs-cancel",
};
</script>

<template>
  <div class="run-status" :class="cls[status]">
    <span class="rs-dot"></span>
    <span class="rs-label">{{ label[status] }}</span>
    <span v-if="message" class="rs-msg">{{ message }}</span>
  </div>
</template>

<style scoped>
.run-status { display: flex; align-items: center; gap: 6px; font-size: 11px; padding: 2px 0; }
.rs-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
.rs-started .rs-dot { background: var(--color-accent); animation: pulse 1.8s infinite; }
.rs-done .rs-dot { background: var(--color-success); }
.rs-fail .rs-dot { background: var(--color-error); }
.rs-cancel .rs-dot { background: var(--color-text-muted); }
.rs-label { color: var(--color-text-muted); font-weight: 500; }
.rs-msg { color: var(--color-error); font-family: var(--font-mono); }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
</style>
