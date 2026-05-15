<script setup lang="ts">
const props = defineProps<{
  block: { kind: "planner_decision"; reasoning: string; action: string; objective?: string; expanded: boolean };
}>();

function toggle() {
  props.block.expanded = !props.block.expanded;
}
</script>

<template>
  <div class="planner-decision" :class="{ expanded: block.expanded }">
    <button class="planner-decision-header" @click="toggle">
      <span class="planner-decision-icon">{{ block.action === '阅读代码' ? '📖' : block.action === '向用户提问' ? '❓' : '✅' }}</span>
      <span class="planner-decision-action">{{ block.action }}</span>
      <span v-if="block.objective" class="planner-decision-objective">{{ block.objective }}</span>
      <span class="planner-decision-chevron">{{ block.expanded ? '▾' : '▸' }}</span>
    </button>
    <div v-if="block.expanded" class="planner-decision-body">
      <pre class="planner-decision-reasoning">{{ block.reasoning }}</pre>
    </div>
  </div>
</template>

<style scoped>
.planner-decision { border-radius: var(--radius-md, 8px); border: 1px solid var(--color-border-subtle); background: var(--color-surface-1); overflow: hidden; }
.planner-decision-header { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px; background: none; border: none; cursor: pointer; font-size: 12px; color: var(--color-text-secondary); text-align: left; }
.planner-decision-header:hover { background: var(--color-surface-2); }
.planner-decision-icon { font-size: 14px; flex-shrink: 0; }
.planner-decision-action { font-weight: 600; color: var(--color-text-primary); white-space: nowrap; }
.planner-decision-objective { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-muted); }
.planner-decision-chevron { margin-left: auto; flex-shrink: 0; font-size: 11px; color: var(--color-text-muted); }
.planner-decision-body { padding: 8px 12px 12px; border-top: 1px solid var(--color-border-subtle); }
.planner-decision-reasoning { margin: 0; font-size: 12px; line-height: 1.5; color: var(--color-text-secondary); white-space: pre-wrap; word-break: break-word; font-family: inherit; }
</style>
