<script setup lang="ts">
import type { ToolCall } from "../../types/chat";

defineProps<{ tool: ToolCall }>();
defineEmits<{ toggle: [tool: ToolCall] }>();

function previewLines(text: string): string {
  return text.split("\n").slice(0, 3).join("\n");
}

function toolSummary(tc: ToolCall): string {
  if (!tc.input) return "";
  try {
    const parsed = JSON.parse(tc.input);
    if (parsed.command) return parsed.command;
    return tc.input;
  } catch {
    return tc.input;
  }
}
</script>

<template>
  <div class="tool-block">
    <button @click="$emit('toggle', tool)" class="tool-header" :class="{ 'tool-running': tool.isRunning, 'tool-error': tool.isError && !tool.isRunning }">
      <span class="tool-indicator" :class="{ active: tool.isRunning }"></span>
      <span class="tool-name">{{ tool.name }}</span>
      <span v-if="tool.source" class="source-badge" :class="tool.source">{{ tool.source === 'local' ? 'Local' : 'Server' }}</span>
      <span class="tool-summary">{{ toolSummary(tool) }}</span>
    </button>
    <div v-if="!tool.expanded && tool.result" class="tool-preview" @click="$emit('toggle', tool)">
      <pre class="tool-content" :class="{ 'tool-content-error': tool.isError }">{{ previewLines(tool.result) }}</pre>
    </div>
    <div v-if="tool.expanded && (tool.input || tool.result)" class="tool-body">
      <pre v-if="tool.input" class="tool-content">{{ tool.input }}</pre>
      <pre v-if="tool.result" class="tool-content" :class="{ 'tool-content-error': tool.isError }">{{ tool.result }}</pre>
    </div>
  </div>
</template>

<style scoped>
.tool-block { margin: 4px 0; }
.tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 0;
  text-align: left;
  cursor: pointer;
  border: none;
  background: none;
  transition: opacity 0.15s ease-out;
}
.tool-header:hover { opacity: 0.8; }
.tool-indicator { width: 6px; height: 6px; border-radius: 50%; background: var(--color-success); flex-shrink: 0; }
.tool-indicator.active { background: var(--color-accent); animation: pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
.tool-error .tool-indicator { background: var(--color-error); }
.tool-name { font-family: var(--font-mono); font-size: 12px; color: var(--color-text-muted); flex-shrink: 0; }
.tool-summary { font-family: var(--font-mono); font-size: 12px; color: var(--color-text-muted); opacity: 0.6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-body { padding: 8px 0 8px 14px; border-left: 1px solid var(--color-border-subtle); margin-left: 2px; }
.tool-preview { padding: 4px 0 4px 14px; border-left: 1px solid var(--color-border-subtle); margin-left: 2px; cursor: pointer; }
.tool-content { font-family: var(--font-mono); font-size: 11px; line-height: 1.6; color: var(--color-text-muted); white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; margin: 4px 0; }
.tool-content-error { color: var(--color-error); }
.source-badge { font-size: 9px; padding: 1px 5px; border-radius: 3px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
.source-badge.local { color: var(--color-env-local); background: var(--color-env-local-bg); }
.source-badge.remote { color: var(--color-env-remote); background: var(--color-env-remote-bg); }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>
