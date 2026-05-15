<script setup lang="ts">
import { marked } from "marked";
import DOMPurify from "dompurify";

const props = defineProps<{ content: string }>();

function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(raw);
}
</script>

<template>
  <div class="agent-block">
    <div class="markdown-body" v-html="renderMarkdown(content)"></div>
  </div>
</template>

<style scoped>
.agent-block { padding: 4px 0; }
.markdown-body { font-size: 14px; line-height: 1.6; color: var(--color-text-primary); }
.markdown-body :deep(p) { margin: 0.5em 0; }
.markdown-body :deep(code) { padding: 2px 5px; border-radius: 3px; background: var(--color-surface-2); font-size: 0.9em; }
.markdown-body :deep(pre) { padding: 12px; border-radius: 6px; background: var(--color-surface-2); overflow-x: auto; }
</style>
