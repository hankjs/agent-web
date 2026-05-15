<script setup lang="ts">
defineProps<{
  label?: string;
}>();
</script>

<template>
  <div class="page-loading" aria-live="polite" aria-label="加载中">
    <div class="page-loading-inner">
      <div class="page-loading-dots">
        <span class="dot" />
        <span class="dot" />
        <span class="dot" />
      </div>
      <div v-if="label" class="page-loading-label">{{ label }}</div>
    </div>
  </div>
</template>

<style scoped>
.page-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
}

.page-loading-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.page-loading-dots {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-muted);
  opacity: 0.3;
  animation: dot-pulse 1.2s ease-in-out infinite;
}

.dot:nth-child(2) {
  animation-delay: 0.15s;
}

.dot:nth-child(3) {
  animation-delay: 0.3s;
}

.page-loading-label {
  font-size: 12px;
  color: var(--color-text-muted);
}

@keyframes dot-pulse {
  0%, 60%, 100% {
    opacity: 0.3;
    transform: scale(1);
  }
  30% {
    opacity: 1;
    transform: scale(1.15);
  }
}

@media (prefers-reduced-motion: reduce) {
  .dot {
    animation: none;
    opacity: 0.6;
  }
}
</style>
