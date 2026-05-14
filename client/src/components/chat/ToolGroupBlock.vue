<script setup lang="ts">
import type { ToolCall } from "../../types/chat";
import ToolBlock from "./ToolBlock.vue";

const props = defineProps<{
  tools: ToolCall[];
  expanded: boolean;
}>();
defineEmits<{ toggleGroup: []; toggle: [tool: ToolCall] }>();

function groupSummary(tools: ToolCall[]): string {
  const agentTool = tools.find((t) => t.name === "Agent");
  let agentLabel = "";
  if (agentTool && agentTool.input) {
    try { const parsed = JSON.parse(agentTool.input); if (parsed.subagent_type) agentLabel = parsed.subagent_type; } catch { /* ignore */ }
  }
  const counts: Record<string, number> = {};
  for (const t of tools) {
    if (t.name === "Agent" && agentLabel) continue;
    counts[t.name] = (counts[t.name] || 0) + 1;
  }
  const inner = Object.entries(counts).map(([name, count]) => count > 1 ? `${name} x${count}` : name).join(", ");
  if (agentLabel) return inner ? `${agentLabel}(${inner})` : agentLabel;
  return Object.entries(counts).map(([name, count]) => `${name} x${count}`).join(", ");
}
</script>

<template>
  <div class="tool-group-block">
    <button @click="$emit('toggleGroup')" class="tool-group-header">
      <span class="tool-indicator" :class="{ active: tools.some(t => t.isRunning) }"></span>
      <span class="tool-group-summary">{{ groupSummary(tools) }}</span>
      <span class="tool-group-meta">({{ tools.length }} tool uses)</span>
      <span class="tool-group-chevron" :class="{ open: expanded }">&#9656;</span>
    </button>
    <div v-if="expanded" class="tool-group-body">
      <ToolBlock v-for="(tc, ti) in tools" :key="ti" :tool="tc" @toggle="$emit('toggle', tc)" />
    </div>
  </div>
</template>

<style scoped>
.tool-group-block { margin: 4px 0; }
.tool-group-header {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 0;
  text-align: left; cursor: pointer; border: none; background: none; transition: opacity 0.15s ease-out;
}
.tool-group-header:hover { opacity: 0.8; }
.tool-indicator { width: 6px; height: 6px; border-radius: 50%; background: var(--color-success); flex-shrink: 0; }
.tool-indicator.active { background: var(--color-accent); animation: pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
.tool-group-summary { font-family: var(--font-mono); font-size: 12px; color: var(--color-text-muted); }
.tool-group-meta { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-muted); opacity: 0.5; }
.tool-group-chevron { font-size: 10px; color: var(--color-text-muted); opacity: 0.6; transition: transform 0.15s ease-out; display: inline-block; }
.tool-group-chevron.open { transform: rotate(90deg); }
.tool-group-body { padding: 4px 0 4px 14px; border-left: 1px solid var(--color-border-subtle); margin-left: 2px; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>
