<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, type Provider } from '../composables/api'

const providers = ref<Provider[]>([])
const loading = ref(true)
const showForm = ref(false)
const editingId = ref<string | null>(null)

const form = ref({
  name: '',
  provider_type: 'openai',
  api_key: '',
  base_url: '',
  default_model: '',
  models_json: '{}',
  priority: 0,
  enabled: true,
})

async function load() {
  loading.value = true
  try {
    providers.value = await api.listProviders()
  } catch (e) { /* ignore */ }
  loading.value = false
}

function resetForm() {
  form.value = { name: '', provider_type: 'openai', api_key: '', base_url: '', default_model: '', models_json: '{}', priority: 0, enabled: true }
  editingId.value = null
  showForm.value = false
}

function startEdit(p: Provider) {
  editingId.value = p.id
  form.value = {
    name: p.name,
    provider_type: p.provider_type,
    api_key: p.api_key,
    base_url: p.base_url,
    default_model: p.default_model,
    models_json: p.models || '{}',
    priority: p.priority,
    enabled: p.enabled,
  }
  showForm.value = true
}

async function save() {
  let models: Record<string, string> = {}
  try { models = JSON.parse(form.value.models_json) } catch { /* ignore */ }
  const data = {
    name: form.value.name,
    provider_type: form.value.provider_type,
    api_key: form.value.api_key,
    base_url: form.value.base_url,
    default_model: form.value.default_model,
    models,
    priority: form.value.priority,
    enabled: form.value.enabled,
  }
  if (editingId.value) {
    await api.updateProvider(editingId.value, data)
  } else {
    await api.createProvider(data)
  }
  resetForm()
  await load()
}

async function remove(id: string) {
  if (!confirm('确定删除该供应商？')) return
  await api.deleteProvider(id)
  await load()
}

async function moveUp(idx: number) {
  if (idx === 0) return
  const items = [...providers.value]
  const prev = items[idx - 1]
  const curr = items[idx]
  await api.updateProvider(curr.id, { ...toData(curr), priority: prev.priority })
  await api.updateProvider(prev.id, { ...toData(prev), priority: curr.priority })
  await load()
}

async function moveDown(idx: number) {
  if (idx >= providers.value.length - 1) return
  const items = [...providers.value]
  const next = items[idx + 1]
  const curr = items[idx]
  await api.updateProvider(curr.id, { ...toData(curr), priority: next.priority })
  await api.updateProvider(next.id, { ...toData(next), priority: curr.priority })
  await load()
}

function toData(p: Provider) {
  let models: Record<string, string> = {}
  try { models = JSON.parse(p.models) } catch { /* ignore */ }
  return { name: p.name, provider_type: p.provider_type, api_key: p.api_key, base_url: p.base_url, default_model: p.default_model, models, priority: p.priority, enabled: p.enabled }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-lg font-semibold text-text-primary">供应商管理</h1>
      <button @click="showForm = true; editingId = null" class="px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:opacity-90">添加供应商</button>
    </div>

    <div v-if="showForm" class="mb-6 p-4 border border-border-subtle rounded-lg space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs text-text-secondary mb-1">名称</label>
          <input v-model="form.name" class="w-full px-2 py-1.5 text-sm border border-border-subtle rounded bg-transparent text-text-primary" />
        </div>
        <div>
          <label class="block text-xs text-text-secondary mb-1">类型</label>
          <select v-model="form.provider_type" class="w-full px-2 py-1.5 text-sm border border-border-subtle rounded bg-transparent text-text-primary">
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-text-secondary mb-1">API 密钥</label>
          <input v-model="form.api_key" type="password" class="w-full px-2 py-1.5 text-sm border border-border-subtle rounded bg-transparent text-text-primary" />
        </div>
        <div>
          <label class="block text-xs text-text-secondary mb-1">接口地址</label>
          <input v-model="form.base_url" class="w-full px-2 py-1.5 text-sm border border-border-subtle rounded bg-transparent text-text-primary" placeholder="https://api.openai.com/v1" />
        </div>
        <div>
          <label class="block text-xs text-text-secondary mb-1">默认模型</label>
          <input v-model="form.default_model" class="w-full px-2 py-1.5 text-sm border border-border-subtle rounded bg-transparent text-text-primary" />
        </div>
        <div>
          <label class="block text-xs text-text-secondary mb-1">优先级</label>
          <input v-model.number="form.priority" type="number" class="w-full px-2 py-1.5 text-sm border border-border-subtle rounded bg-transparent text-text-primary" />
        </div>
        <div class="col-span-2">
          <label class="block text-xs text-text-secondary mb-1">模型映射 (JSON)</label>
          <input v-model="form.models_json" class="w-full px-2 py-1.5 text-sm border border-border-subtle rounded bg-transparent text-text-primary font-mono" placeholder='{"别名": "实际模型ID"}' />
        </div>
        <div class="flex items-center gap-2">
          <input v-model="form.enabled" type="checkbox" id="enabled" />
          <label for="enabled" class="text-xs text-text-secondary">启用</label>
        </div>
      </div>
      <div class="flex gap-2">
        <button @click="save" class="px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:opacity-90">{{ editingId ? '更新' : '创建' }}</button>
        <button @click="resetForm" class="px-3 py-1.5 text-xs border border-border-subtle rounded-md text-text-secondary hover:bg-hover">取消</button>
      </div>
    </div>

    <div v-if="loading" class="text-sm text-text-tertiary">加载中...</div>
    <table v-else class="w-full text-sm">
      <thead>
        <tr class="text-left text-xs text-text-tertiary border-b border-border-subtle">
          <th class="py-2 pr-3">优先级</th>
          <th class="py-2 pr-3">名称</th>
          <th class="py-2 pr-3">类型</th>
          <th class="py-2 pr-3">模型</th>
          <th class="py-2 pr-3">状态</th>
          <th class="py-2">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(p, idx) in providers" :key="p.id" class="border-b border-border-subtle">
          <td class="py-2 pr-3 text-text-secondary">
            <span class="inline-flex gap-1">
              <button @click="moveUp(idx)" :disabled="idx === 0" class="text-xs disabled:opacity-30">▲</button>
              <button @click="moveDown(idx)" :disabled="idx === providers.length - 1" class="text-xs disabled:opacity-30">▼</button>
              <span class="ml-1">{{ p.priority }}</span>
            </span>
          </td>
          <td class="py-2 pr-3 text-text-primary font-medium">{{ p.name }}</td>
          <td class="py-2 pr-3 text-text-secondary">{{ p.provider_type }}</td>
          <td class="py-2 pr-3 text-text-secondary font-mono text-xs">{{ p.default_model || '—' }}</td>
          <td class="py-2 pr-3">
            <span :class="p.enabled ? 'text-green-500' : 'text-text-tertiary'">{{ p.enabled ? '已启用' : '已禁用' }}</span>
          </td>
          <td class="py-2">
            <button @click="startEdit(p)" class="text-xs text-accent hover:underline mr-2">编辑</button>
            <button @click="remove(p.id)" class="text-xs text-red-400 hover:underline">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
