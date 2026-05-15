<script setup lang="ts">
defineProps<{ content: string }>();
</script>

<template>
  <div class="error-block">{{ content }}</div>
</template>

<style scoped>
.error-block { padding: 8px 12px; border-radius: 6px; background: var(--color-error-surface); color: var(--color-error); font-size: 13px; }
</style>
