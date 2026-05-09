<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, type MetricsOverview, type Session } from '../composables/api'

const overview = ref<MetricsOverview | null>(null)
const recentSessions = ref<Session[]>([])

onMounted(async () => {
  overview.value = await api.metricsOverview()
  const res = await api.sessions(1, 5)
  recentSessions.value = res.data
})

function formatTokens(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}
</script>

<template>
  <div>
    <h1 class="text-lg font-semibold text-text-primary mb-8">Overview</h1>

    <div v-if="overview" class="grid grid-cols-3 gap-12 mb-12">
      <div>
        <div class="text-[13px] text-text-tertiary mb-1">Tokens</div>
        <div class="text-2xl font-semibold tabular-nums">{{ formatTokens(overview.total_input_tokens + overview.total_output_tokens) }}</div>
        <div class="text-[12px] text-text-tertiary mt-1">{{ formatTokens(overview.total_input_tokens) }} in · {{ formatTokens(overview.total_output_tokens) }} out</div>
      </div>
      <div>
        <div class="text-[13px] text-text-tertiary mb-1">Avg latency</div>
        <div class="text-2xl font-semibold tabular-nums">{{ Math.round(overview.avg_latency_ms) }}<span class="text-sm font-normal text-text-tertiary">ms</span></div>
        <div class="text-[12px] text-text-tertiary mt-1">{{ overview.total_llm_calls }} calls</div>
      </div>
      <div>
        <div class="text-[13px] text-text-tertiary mb-1">Tool errors</div>
        <div class="text-2xl font-semibold tabular-nums">{{ overview.tool_total_count ? ((overview.tool_error_count / overview.tool_total_count) * 100).toFixed(1) : 0 }}<span class="text-sm font-normal text-text-tertiary">%</span></div>
        <div class="text-[12px] text-text-tertiary mt-1">{{ overview.tool_error_count }} / {{ overview.tool_total_count }}</div>
      </div>
    </div>

    <div class="mb-3 text-[13px] text-text-tertiary font-medium">Recent sessions</div>
    <div class="divide-y divide-border-subtle">
      <RouterLink
        v-for="s in recentSessions"
        :key="s.id"
        :to="`/sessions/${s.id}`"
        class="flex items-center justify-between py-2.5 -mx-2 px-2 rounded-md hover:bg-hover transition-colors duration-100 cursor-pointer"
      >
        <div class="min-w-0">
          <div class="text-[13px] text-text-primary truncate">{{ s.title || s.id.slice(0, 8) }}</div>
          <div class="text-[12px] text-text-tertiary">{{ s.provider }} · {{ s.model }}</div>
        </div>
        <div class="text-[12px] text-text-tertiary shrink-0 ml-4">{{ new Date(s.updated_at).toLocaleDateString() }}</div>
      </RouterLink>
      <div v-if="!recentSessions.length" class="py-8 text-center text-[13px] text-text-tertiary">No sessions yet</div>
    </div>
  </div>
</template>
