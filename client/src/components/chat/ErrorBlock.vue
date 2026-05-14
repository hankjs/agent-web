<script setup lang="ts">
defineProps<{ content: string }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="error-block">
    <span class="error-message">{{ content }}</span>
    <button v-if="content.includes('not configured')" class="retry-btn" @click="$emit('retry')">Go to Settings</button>
    <button v-else class="retry-btn" @click="$emit('retry')">Retry</button>
  </div>
</template>

<style scoped>
.error-block {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--color-error-surface);
  border: 1px solid color-mix(in oklch, var(--color-error) 25%, transparent);
  border-radius: 6px;
  margin: 4px 0;
}
.error-message {
  font-size: 13px;
  color: var(--color-error);
  flex: 1;
}
.retry-btn {
  flex-shrink: 0;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.retry-btn:hover:not(:disabled) { background: var(--color-surface-2, rgba(255,255,255,0.06)); border-color: var(--color-text-muted); }
.retry-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
