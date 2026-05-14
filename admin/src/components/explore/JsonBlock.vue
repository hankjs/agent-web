<script setup lang="ts">
import { ref, computed } from 'vue'
import hljs from 'highlight.js/lib/core'
import json from 'highlight.js/lib/languages/json'
import 'highlight.js/styles/github-dark-dimmed.css'

hljs.registerLanguage('json', json)

const props = defineProps<{
  content: string
  maxHeight?: string
}>()

const copied = ref(false)

async function copy() {
  await navigator.clipboard.writeText(props.content)
  copied.value = true
  setTimeout(() => copied.value = false, 1500)
}

const highlighted = computed(() => {
  try {
    // Try to parse and re-format as JSON for consistent highlighting
    const parsed = JSON.parse(props.content)
    const formatted = JSON.stringify(parsed, null, 2)
    return hljs.highlight(formatted, { language: 'json' }).value
  } catch {
    // Not valid JSON — try highlighting anyway, fallback to escaped plain text
    try {
      return hljs.highlight(props.content, { language: 'json' }).value
    } catch {
      return props.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }
  }
})
</script>

<template>
  <div class="relative mt-2">
    <button @click.stop="copy"
      class="absolute top-1.5 right-1.5 p-0.5 rounded hover:bg-white/10 transition-colors text-text-tertiary hover:text-text-secondary z-10"
      :title="copied ? '已复制' : '复制'"
    >
      <svg v-if="!copied" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
    </button>
    <pre
      class="hljs text-[10px] whitespace-pre-wrap overflow-y-auto p-2 pr-6 rounded font-mono"
      :style="{ maxHeight: maxHeight || '15rem' }"
      v-html="highlighted"
    ></pre>
  </div>
</template>

<style scoped>
pre.hljs {
  border: 1px solid var(--color-border-subtle, #333);
  border-radius: 0.375rem;
}
</style>
