<script setup lang="ts">
defineProps<{ data: any }>();
</script>

<template>
  <div class="structured-card">
    <div class="structured-card-title">{{ data.title }}</div>
    <div v-for="(section, si) in data.sections" :key="si" class="structured-card-section">
      <div class="structured-card-heading">{{ section.heading }}</div>
      <ul class="structured-card-items">
        <li v-for="(it, ii) in section.items" :key="ii">{{ it }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.structured-card {
  margin: 10px 0;
  border: 1px solid color-mix(in oklch, var(--color-accent) 30%, transparent);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  overflow: hidden;
}
.structured-card-title {
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  border-bottom: 1px solid color-mix(in oklch, var(--color-accent) 15%, transparent);
  background: color-mix(in oklch, var(--color-accent) 6%, var(--color-surface-1));
}
.structured-card-section { padding: 10px 16px; }
.structured-card-section + .structured-card-section {
  border-top: 1px solid color-mix(in oklch, var(--color-border) 50%, transparent);
}
.structured-card-heading {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}
.structured-card-items { margin: 0; padding-left: 18px; list-style: disc; }
.structured-card-items li { font-size: 13px; color: var(--color-text-primary); line-height: 1.6; }
</style>
