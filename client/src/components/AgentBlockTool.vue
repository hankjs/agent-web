<script setup lang="ts">
import type { Block } from "../agents/ExploreAgent/types";

type ToolBlock = Extract<Block, { kind: "tool" }>;
defineProps<{ tool: ToolBlock["tool"] }>();
</script>

<template>
  <div class="tool-block" @click="tool.expanded = !tool.expanded">
    <div class="tool-header">
      <span class="tool-indicator" :class="{ running: tool.isRunning, error: tool.isError }"></span>
      <span class="tool-name">{{ tool.name }}</span>
      <span v-if="tool.isRunning" class="tool-running">运行中...</span>
    </div>
    <div v-if="tool.expanded" class="tool-detail">
      <pre v-if="tool.input" class="tool-input">{{ tool.input }}</pre>
      <pre v-if="tool.result" class="tool-result" :class="{ 'tool-error': tool.isError }">{{ tool.result?.slice(0, 500) }}</pre>
    </div>
  </div>
</template>

<style scoped>
.tool-block { padding: 6px 10px; border-radius: 6px; background: var(--color-surface-1); cursor: pointer; font-size: 12px; }
.tool-header { display: flex; align-items: center; gap: 8px; }
.tool-indicator { width: 6px; height: 6px; border-radius: 50%; background: var(--color-text-muted); }
.tool-indicator.running { background: var(--color-success); animation: pulse 1s infinite; }
.tool-indicator.error { background: var(--color-error); }
.tool-name { font-weight: 500; color: var(--color-text-secondary); }
.tool-running { color: var(--color-text-muted); font-size: 11px; }
.tool-detail { margin-top: 8px; }
.tool-input, .tool-result { font-size: 11px; padding: 6px 8px; border-radius: 4px; background: var(--color-surface-2); overflow-x: auto; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; }
.tool-result { margin-top: 4px; }
.tool-error { color: var(--color-error); }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
</style>
