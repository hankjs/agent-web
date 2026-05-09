<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, type PromptTemplate } from '../composables/api'
import { useAiGenerate } from '../composables/useAiGenerate'

const { open } = useAiGenerate()

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

async function deleteTemplate(id: string) {
  await api.deletePromptTemplate(id)
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
  <div>
    <h1 class="text-lg font-semibold text-text-primary mb-6">Prompts</h1>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-10">
      <div>
        <div class="space-y-3 mb-8">
          <input
            v-model="name"
            placeholder="Template name"
            class="w-full bg-transparent border border-border rounded-md px-3 py-2 text-[13px] placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors"
          />
          <textarea
            v-model="content"
            placeholder="System prompt..."
            rows="10"
            class="w-full bg-transparent border border-border rounded-md px-3 py-2 text-[13px] font-mono leading-relaxed placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors resize-y"
          ></textarea>
          <div class="flex items-center gap-2">
            <button
              @click="saveTemplate"
              class="px-3.5 py-1.5 bg-text-primary text-surface-raised text-[13px] rounded-md hover:opacity-80 transition-opacity"
            >Save</button>
            <button
              @click="open(text => content = text)"
              class="px-2 py-1.5 text-[13px] text-text-tertiary hover:text-accent transition-colors"
              title="AI 生成"
            >✨</button>
          </div>
        </div>

        <div v-if="templates.length">
          <div class="text-[13px] text-text-tertiary font-medium mb-3">Saved</div>
          <div class="divide-y divide-border-subtle">
            <div v-for="t in templates" :key="t.id" class="flex items-center justify-between py-2.5">
              <div class="min-w-0">
                <div class="text-[13px] text-text-primary">{{ t.name }} <span class="text-text-tertiary">v{{ t.version }}</span></div>
                <div class="text-[12px] text-text-tertiary truncate mt-0.5">{{ t.content.slice(0, 60) }}</div>
              </div>
              <button @click="content = t.content; name = t.name" class="text-[12px] text-accent hover:text-accent-hover shrink-0 ml-3 transition-colors">Load</button>
              <button @click="deleteTemplate(t.id)" class="text-[12px] text-text-tertiary hover:text-red-500 shrink-0 ml-2 transition-colors">删除</button>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div class="text-[13px] text-text-tertiary font-medium mb-3">Replay</div>
        <div class="space-y-3">
          <input
            v-model="replaySessionId"
            placeholder="Session ID"
            class="w-full bg-transparent border border-border rounded-md px-3 py-2 text-[13px] font-mono placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors"
          />
          <button
            @click="runReplay()"
            :disabled="isReplaying"
            class="px-3.5 py-1.5 bg-text-primary text-surface-raised text-[13px] rounded-md hover:opacity-80 disabled:opacity-40 transition-opacity"
          >{{ isReplaying ? 'Running...' : 'Run' }}</button>
        </div>

        <div v-if="replayOutput.length" class="mt-6">
          <div class="text-[13px] text-text-tertiary font-medium mb-2">Output</div>
          <pre class="text-[12px] text-text-secondary whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">{{ replayOutput.join('') }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>
