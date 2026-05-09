<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { api, type DbMessage, type AgentMetric, type ToolExecution } from '../composables/api'

const route = useRoute()
const sessionId = route.params.id as string

const messages = ref<DbMessage[]>([])
const metrics = ref<AgentMetric[]>([])
const toolExecs = ref<ToolExecution[]>([])

onMounted(async () => {
  const data = await api.sessionReplay(sessionId)
  messages.value = data.messages
  metrics.value = data.metrics
  toolExecs.value = data.tool_executions
})

function parseContent(content: string) {
  try {
    return JSON.parse(content)
  } catch {
    return [{ type: 'text', text: content }]
  }
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold text-gray-900 mb-4">Session {{ sessionId.slice(0, 8) }}</h1>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Messages -->
      <div class="lg:col-span-2 space-y-3">
        <h2 class="text-lg font-semibold text-gray-800">Conversation</h2>
        <div v-for="msg in messages" :key="msg.id" class="bg-white rounded-lg border p-4">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-xs font-medium px-2 py-0.5 rounded" :class="msg.role === 'user' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'">
              {{ msg.role }}
            </span>
            <span class="text-xs text-gray-400">{{ new Date(msg.created_at).toLocaleTimeString() }}</span>
          </div>
          <div v-for="(block, i) in parseContent(msg.content)" :key="i" class="text-sm text-gray-700">
            <template v-if="block.type === 'text'">
              <pre class="whitespace-pre-wrap font-sans">{{ block.text }}</pre>
            </template>
            <template v-else-if="block.type === 'tool_use'">
              <div class="mt-1 p-2 bg-gray-50 rounded text-xs font-mono">Tool: {{ block.name }}</div>
            </template>
            <template v-else-if="block.type === 'tool_result'">
              <div class="mt-1 p-2 bg-gray-50 rounded text-xs font-mono truncate">Result: {{ block.content?.slice(0, 200) }}</div>
            </template>
          </div>
        </div>
      </div>

      <!-- Metrics sidebar -->
      <div class="space-y-4">
        <h2 class="text-lg font-semibold text-gray-800">Metrics</h2>
        <div v-for="m in metrics" :key="m.id" class="bg-white rounded-lg border p-3 text-sm">
          <div class="flex justify-between">
            <span class="text-gray-500">Tokens</span>
            <span>{{ m.input_tokens }} / {{ m.output_tokens }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-500">Latency</span>
            <span>{{ m.latency_ms }}ms</span>
          </div>
          <div class="text-xs text-gray-400 mt-1">{{ m.model }}</div>
        </div>

        <h2 class="text-lg font-semibold text-gray-800 mt-6">Tool Executions</h2>
        <div v-for="t in toolExecs" :key="t.id" class="bg-white rounded-lg border p-3 text-sm">
          <div class="flex justify-between">
            <span class="font-medium">{{ t.tool_name }}</span>
            <span :class="t.is_error ? 'text-red-500' : 'text-green-500'">{{ t.duration_ms }}ms</span>
          </div>
        </div>
        <div v-if="!metrics.length && !toolExecs.length" class="text-sm text-gray-400">No metrics recorded</div>
      </div>
    </div>
  </div>
</template>
