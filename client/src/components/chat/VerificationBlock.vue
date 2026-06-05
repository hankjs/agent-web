<script setup lang="ts">
defineProps<{
  status: "started" | "completed";
  verdict?: "approved" | "needs_revision" | "rejected";
  issues?: string[];
}>();

const verdictLabel: Record<string, string> = { approved: "通过", needs_revision: "需修改", rejected: "被拒绝" };
const verdictClass: Record<string, string> = { approved: "v-approved", needs_revision: "v-revision", rejected: "v-rejected" };
</script>

<template>
  <div class="verify-block">
    <span class="verify-icon" :class="{ spinning: status === 'started' }">&#10003;</span>
    <span class="verify-label">{{ status === "started" ? "验证中…" : "验证完成" }}</span>
    <span v-if="verdict" class="verify-verdict" :class="verdictClass[verdict]">{{ verdictLabel[verdict] }}</span>
    <ul v-if="issues?.length" class="verify-issues">
      <li v-for="(issue, i) in issues" :key="i">{{ issue }}</li>
    </ul>
  </div>
</template>

<style scoped>
.verify-block { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 6px; padding: 4px 0; font-size: 12px; }
.verify-icon { color: var(--color-success); flex-shrink: 0; }
.verify-icon.spinning { animation: spin 1.2s linear infinite; display: inline-block; color: var(--color-accent); }
.verify-label { color: var(--color-text-muted); }
.verify-verdict { font-weight: 600; padding: 1px 6px; border-radius: 3px; }
.v-approved { color: var(--color-success); background: var(--color-success-surface); }
.v-revision { color: var(--color-warning, #f59e0b); background: rgba(245,158,11,0.12); }
.v-rejected { color: var(--color-error); background: var(--color-error-surface); }
.verify-issues { width: 100%; margin: 4px 0 0 18px; padding: 0; list-style: disc; color: var(--color-error); }
.verify-issues li { font-size: 11px; font-family: var(--font-mono); }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
