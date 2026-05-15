<script setup lang="ts">
import type { Block } from "../agents/ExploreAgent/types";

type ExploreRoundBlock = Extract<Block, { kind: "explore_round" }>;
defineProps<{ block: ExploreRoundBlock }>();
</script>

<template>
  <div class="explore-round" :class="{ running: block.isRunning }">
    <div class="explore-round-header" @click="block.expanded = !block.expanded">
      <span class="explore-round-indicator" :class="{ running: block.isRunning }"></span>
      <span class="explore-round-objective">{{ block.objective }}</span>
      <span v-if="block.isRunning" class="explore-round-status">探索中...</span>
      <span v-else class="explore-round-status done">{{ block.tools.length }} 次调用</span>
      <span class="explore-round-toggle">{{ block.expanded ? '▾' : '▸' }}</span>
    </div>
    <div v-if="block.expanded" class="explore-round-body">
      <div v-if="block.reasoning" class="explore-round-reasoning">{{ block.reasoning }}</div>
      <div v-for="tool in block.tools" :key="tool.id" class="explore-round-tool" @click.stop="tool.expanded = !tool.expanded">
        <div class="tool-header">
          <span class="tool-indicator" :class="{ running: tool.isRunning, error: tool.isError }"></span>
          <span class="tool-name">{{ tool.name }}</span>
          <span v-if="tool.isRunning" class="tool-running">运行中...</span>
          <span v-else-if="tool.result" class="tool-done">✓</span>
        </div>
        <div v-if="tool.expanded" class="tool-detail">
          <pre v-if="tool.input" class="tool-input">{{ tool.input }}</pre>
          <pre v-if="tool.result" class="tool-result" :class="{ 'tool-error': tool.isError }">{{ tool.result?.slice(0, 500) }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.explore-round { border-radius: 8px; border: 1px solid var(--color-border-subtle); background: var(--color-surface-1); overflow: hidden; }
.explore-round.running { border-color: color-mix(in srgb, var(--color-accent) 40%, transparent); }
.explore-round-header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: pointer; }
.explore-round-indicator { width: 7px; height: 7px; border-radius: 50%; background: var(--color-text-muted); flex-shrink: 0; }
.explore-round-indicator.running { background: var(--color-success); animation: pulse 1s infinite; }
.explore-round-objective { flex: 1; font-size: 13px; font-weight: 500; color: var(--color-text-primary); line-height: 1.4; }
.explore-round-status { font-size: 11px; color: var(--color-text-muted); flex-shrink: 0; }
.explore-round-status.done { color: var(--color-text-muted); }
.explore-round-toggle { font-size: 11px; color: var(--color-text-muted); }
.explore-round-body { padding: 0 12px 10px; display: flex; flex-direction: column; gap: 6px; }
.explore-round-reasoning { font-size: 12px; color: var(--color-text-secondary); line-height: 1.5; padding: 6px 8px; border-radius: 4px; background: var(--color-surface-2); margin-bottom: 4px; }
.explore-round-tool { padding: 4px 8px; border-radius: 4px; background: var(--color-surface-2); cursor: pointer; font-size: 12px; }
.explore-round-tool .tool-header { display: flex; align-items: center; gap: 6px; }
.explore-round-tool .tool-done { font-size: 10px; color: var(--color-success); }
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
