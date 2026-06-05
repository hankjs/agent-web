<script setup lang="ts">
defineProps<{
  tool: string;
  risk: string;
  reason: string;
  answered: boolean;
}>();

const riskClass: Record<string, string> = { low: "risk-low", medium: "risk-medium", high: "risk-high", critical: "risk-high" };
</script>

<template>
  <div class="perm-block" :class="{ answered }">
    <div class="perm-header">
      <span class="perm-icon">&#9888;</span>
      <span class="perm-title">权限拒绝</span>
      <span class="perm-risk" :class="riskClass[risk] || 'risk-medium'">{{ risk }}</span>
    </div>
    <div class="perm-tool">{{ tool }}</div>
    <div class="perm-reason">{{ reason }}</div>
  </div>
</template>

<style scoped>
.perm-block { padding: 8px 12px; border-radius: 6px; border-left: 3px solid var(--color-warning, #f59e0b); background: var(--color-warning-surface, rgba(245,158,11,0.06)); }
.perm-header { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
.perm-icon { color: var(--color-warning, #f59e0b); font-size: 12px; }
.perm-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); }
.perm-risk { font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 3px; text-transform: uppercase; }
.risk-low { color: var(--color-success); background: var(--color-success-surface); }
.risk-medium { color: var(--color-warning, #f59e0b); background: rgba(245,158,11,0.12); }
.risk-high { color: var(--color-error); background: var(--color-error-surface); }
.perm-tool { font-family: var(--font-mono); font-size: 12px; color: var(--color-text-primary); }
.perm-reason { font-size: 12px; color: var(--color-text-muted); }
</style>
