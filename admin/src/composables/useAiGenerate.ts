import { ref } from 'vue'
import { api } from './api'

const visible = ref(false)
const generating = ref(false)
const output = ref('')
let callback: ((text: string) => void) | null = null

export function useAiGenerate() {
  function open(cb: (text: string) => void) {
    callback = cb
    output.value = ''
    visible.value = true
  }

  function close() {
    visible.value = false
    generating.value = false
    output.value = ''
    callback = null
  }

  async function generate(prompt: string) {
    if (!prompt.trim() || generating.value) return
    generating.value = true
    output.value = ''

    const res = await api.chatGenerate(prompt)
    const reader = res.body?.getReader()
    const decoder = new TextDecoder()
    if (!reader) { generating.value = false; return }

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
              output.value += event.text
            }
          } catch { /* skip */ }
        }
      }
    }
    generating.value = false
  }

  function confirm() {
    if (callback) callback(output.value)
    close()
  }

  return { visible, generating, output, open, close, generate, confirm }
}
