<script setup lang="ts">
import { formatMs, type ExploreStats } from './types'

defineProps<{ stats: ExploreStats }>()
</script>

<template>
  <div class="flex flex-wrap items-center gap-4 mb-6 px-3 py-2.5 rounded-lg border border-border bg-surface-raised/30 text-[11px] text-text-tertiary">
    <span>{{ stats.llmCalls }} LLM calls</span>
    <span>{{ stats.toolCalls }} tool calls</span>
    <span>{{ stats.findings }} findings</span>
    <span>{{ stats.tokensIn.toLocaleString() }}↑ {{ stats.tokensOut.toLocaleString() }}↓ tok</span>
    <span>{{ formatMs(stats.lastElapsed) }} total</span>
  </div>
</template>
