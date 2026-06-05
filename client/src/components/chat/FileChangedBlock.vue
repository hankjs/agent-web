<script setup lang="ts">
import type { FileChange } from "../../types/chat";
defineProps<{ changes: FileChange[] }>();

const kindLabel: Record<string, string> = { add: "+", update: "~", delete: "-" };
const kindClass: Record<string, string> = { add: "fc-add", update: "fc-update", delete: "fc-delete" };
</script>

<template>
  <div class="file-changed-block">
    <span class="fc-label">文件变更</span>
    <div v-for="c in changes" :key="c.path" class="fc-row">
      <span class="fc-kind" :class="kindClass[c.kind]">{{ kindLabel[c.kind] }}</span>
      <span class="fc-path">{{ c.path }}</span>
    </div>
  </div>
</template>

<style scoped>
.file-changed-block { padding: 6px 0; }
.fc-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); opacity: 0.6; margin-bottom: 4px; display: block; }
.fc-row { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
.fc-kind { font-family: var(--font-mono); font-size: 11px; font-weight: 700; width: 12px; flex-shrink: 0; }
.fc-add { color: var(--color-success); }
.fc-update { color: var(--color-accent); }
.fc-delete { color: var(--color-error); }
.fc-path { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-muted); }
</style>
