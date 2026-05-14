<script setup lang="ts">
defineProps<{ summary: string }>()
</script>

<template>
  <div class="mt-6 p-4 rounded-lg border border-border bg-surface-raised/30">
    <div class="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-2">最终摘要</div>
    <div class="text-[12px] text-text-secondary whitespace-pre-wrap">{{ summary }}</div>
  </div>
</template>
