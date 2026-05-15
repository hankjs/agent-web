<script setup lang="ts">
defineProps<{ content: string }>();
</script>

<template>
  <div class="thinking-block">
    <span class="thinking-indicator"></span>
    <pre class="thinking-text">{{ content || '思考中...' }}</pre>
  </div>
</template>

<style scoped>
.thinking-block { display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px; border-radius: 6px; background: var(--color-surface-1); border-left: 2px solid var(--color-accent); }
.thinking-indicator { width: 6px; height: 6px; border-radius: 50%; background: var(--color-accent); animation: pulse 1s infinite; flex-shrink: 0; margin-top: 5px; }
.thinking-text { font-size: 12px; color: var(--color-text-secondary); line-height: 1.5; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; margin: 0; font-family: inherit; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
</style>
