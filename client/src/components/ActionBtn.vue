<script setup lang="ts">
defineProps<{
  variant?: "default" | "primary" | "danger" | "cancel";
  disabled?: boolean;
}>();
</script>

<template>
  <button class="action-btn" :class="variant" :disabled="disabled">
    <slot />
  </button>
</template>

<style scoped>
.action-btn {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  color: var(--color-text-secondary);
  transition: background var(--duration-fast), color var(--duration-fast);
  white-space: nowrap;
}

.action-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
  color: var(--color-text-primary);
}

.action-btn.primary {
  background: var(--color-accent);
  color: var(--color-surface-0);
  border-color: transparent;
}

.action-btn.primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.action-btn.danger {
  color: var(--color-error);
  border-color: var(--color-error);
  opacity: 0.7;
}

.action-btn.danger:hover:not(:disabled) {
  opacity: 1;
  background: var(--color-error);
  color: var(--color-surface-0);
}

.action-btn.cancel {
  color: var(--color-text-secondary);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
