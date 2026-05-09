<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, type PromptTemplate } from '../composables/api'

const templates = ref<PromptTemplate[]>([])
const name = ref('')
const content = ref('')
const replaySessionId = ref('')
const replayOutput = ref<string[]>([])
const isReplaying = ref(false)

async function loadTemplates() {
  templates.value = await api.listPromptTemplates()
}

async function saveTemplate() {
  if (!name.value || !content.value) return
  await api.createPromptTemplate(name.value, content.value)
  name.value = ''
  content.value = ''
  await loadTemplates()
}

async function runReplay(templateId?: string) {
  if (!replaySessionId.value) return
  isReplaying.value = true
  replayOutput.value = []

  const res = await api.replay(replaySessionId.value, {
    prompt_template_id: templateId,
    system_prompt: templateId ? undefined : content.value || undefined,
  })

  const reader = res.body?.getReader()
  const decoder = new TextDecoder()
  if (!reader) return

  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event = JSON.parse(line.slice(6))
          if (event.type === 'text_delta') {
            replayOutput.value.push(event.text)
          }
        } catch { /* skip */ }
      }
    }
  }
  isReplaying.value = false
}

onMounted(loadTemplates)
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <!-- Template Editor -->
    <div>
      <h1 class="text-2xl font-bold text-gray-900 mb-4">Prompt Lab</h1>

      <div class="bg-white rounded-lg border p-4 space-y-3">
        <input v-model="name" placeholder="Template name" class="w-full border rounded px-3 py-2 text-sm" />
        <textarea v-model="content" placeholder="System prompt content..." rows="10" class="w-full border rounded px-3 py-2 text-sm font-mono"></textarea>
        <button @click="saveTemplate" class="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">Save Template</button>
      </div>

      <h2 class="text-lg font-semibold text-gray-800 mt-6 mb-3">Saved Templates</h2>
      <div class="space-y-2">
        <div v-for="t in templates" :key="t.id" class="bg-white rounded-lg border p-3 text-sm">
          <div class="flex items-center justify-between">
            <span class="font-medium">{{ t.name }} <span class="text-gray-400">v{{ t.version }}</span></span>
            <button @click="content = t.content; name = t.name" class="text-xs text-blue-600 hover:underline">Load</button>
          </div>
          <div class="text-xs text-gray-400 mt-1 truncate">{{ t.content.slice(0, 80) }}</div>
        </div>
      </div>
    </div>

    <!-- Replay Panel -->
    <div>
      <h2 class="text-lg font-semibold text-gray-800 mb-3">Compare Replay</h2>
      <div class="bg-white rounded-lg border p-4 space-y-3">
        <input v-model="replaySessionId" placeholder="Session ID to replay" class="w-full border rounded px-3 py-2 text-sm" />
        <button @click="runReplay()" :disabled="isReplaying" class="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50">
          {{ isReplaying ? 'Replaying...' : 'Run Replay' }}
        </button>
      </div>

      <div v-if="replayOutput.length" class="mt-4 bg-white rounded-lg border p-4">
        <h3 class="text-sm font-medium text-gray-700 mb-2">Output</h3>
        <pre class="text-sm text-gray-600 whitespace-pre-wrap font-mono max-h-96 overflow-y-auto">{{ replayOutput.join('') }}</pre>
      </div>
    </div>
  </div>
</template>
