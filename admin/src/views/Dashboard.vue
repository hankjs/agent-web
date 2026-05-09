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
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

    <div v-if="overview" class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      <div class="bg-white rounded-lg border p-4">
        <div class="text-sm text-gray-500">Total Tokens</div>
        <div class="text-2xl font-semibold">{{ (overview.total_input_tokens + overview.total_output_tokens).toLocaleString() }}</div>
        <div class="text-xs text-gray-400 mt-1">In: {{ overview.total_input_tokens.toLocaleString() }} / Out: {{ overview.total_output_tokens.toLocaleString() }}</div>
      </div>
      <div class="bg-white rounded-lg border p-4">
        <div class="text-sm text-gray-500">Avg Latency</div>
        <div class="text-2xl font-semibold">{{ Math.round(overview.avg_latency_ms) }}ms</div>
        <div class="text-xs text-gray-400 mt-1">{{ overview.total_llm_calls }} LLM calls</div>
      </div>
      <div class="bg-white rounded-lg border p-4">
        <div class="text-sm text-gray-500">Tool Error Rate</div>
        <div class="text-2xl font-semibold">{{ overview.tool_total_count ? ((overview.tool_error_count / overview.tool_total_count) * 100).toFixed(1) : 0 }}%</div>
        <div class="text-xs text-gray-400 mt-1">{{ overview.tool_error_count }} / {{ overview.tool_total_count }} executions</div>
      </div>
    </div>

    <h2 class="text-lg font-semibold text-gray-800 mb-3">Recent Sessions</h2>
    <div class="bg-white rounded-lg border">
      <div v-for="s in recentSessions" :key="s.id" class="flex items-center justify-between px-4 py-3 border-b last:border-b-0">
        <div>
          <RouterLink :to="`/sessions/${s.id}`" class="text-sm font-medium text-blue-600 hover:underline">{{ s.title || s.id.slice(0, 8) }}</RouterLink>
          <div class="text-xs text-gray-400">{{ s.provider }} / {{ s.model }}</div>
        </div>
        <div class="text-xs text-gray-400">{{ new Date(s.updated_at).toLocaleString() }}</div>
      </div>
      <div v-if="!recentSessions.length" class="px-4 py-6 text-center text-gray-400 text-sm">No sessions yet</div>
    </div>
  </div>
</template>
