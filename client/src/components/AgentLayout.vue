<script setup lang="ts">
defineProps<{
  activePanelId?: string | null;
}>();
</script>

<template>
  <div class="agent-layout">
    <slot name="header" />
    <slot />
    <slot name="input" />
    <slot name="sidebar" />
  </div>
</template>

<style scoped>
.agent-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--color-bg);
  position: relative;
}
</style>
