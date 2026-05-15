<script setup lang="ts">
defineProps<{ content: string }>();
</script>

<template>
  <div class="user-block">
    <pre class="whitespace-pre-wrap text-[13px] leading-relaxed font-medium" style="color: var(--color-text-primary)">{{ content }}</pre>
  </div>
</template>

<style scoped>
.user-block { padding: 12px 16px; border-radius: 8px; background: var(--color-surface-1); }
</style>
