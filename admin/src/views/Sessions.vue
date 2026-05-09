<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { api, type Session, type PaginatedResponse } from '../composables/api'

const sessions = ref<Session[]>([])
const total = ref(0)
const page = ref(1)
const search = ref('')
const perPage = 20

async function load() {
  const res: PaginatedResponse<Session> = await api.sessions(page.value, perPage, search.value)
  sessions.value = res.data
  total.value = res.total
}

onMounted(load)
watch([page, search], load)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-bold text-gray-900">Sessions</h1>
      <input v-model="search" placeholder="Search..." class="border rounded px-3 py-1.5 text-sm w-64" />
    </div>

    <div class="bg-white rounded-lg border">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 border-b">
          <tr>
            <th class="text-left px-4 py-2 font-medium text-gray-600">Title</th>
            <th class="text-left px-4 py-2 font-medium text-gray-600">Provider</th>
            <th class="text-left px-4 py-2 font-medium text-gray-600">Model</th>
            <th class="text-left px-4 py-2 font-medium text-gray-600">Updated</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in sessions" :key="s.id" class="border-b last:border-b-0 hover:bg-gray-50">
            <td class="px-4 py-2">
              <RouterLink :to="`/sessions/${s.id}`" class="text-blue-600 hover:underline">{{ s.title || s.id.slice(0, 8) }}</RouterLink>
            </td>
            <td class="px-4 py-2 text-gray-500">{{ s.provider }}</td>
            <td class="px-4 py-2 text-gray-500">{{ s.model }}</td>
            <td class="px-4 py-2 text-gray-400">{{ new Date(s.updated_at).toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex items-center justify-between mt-4 text-sm text-gray-500">
      <span>{{ total }} total</span>
      <div class="flex gap-2">
        <button @click="page = Math.max(1, page - 1)" :disabled="page <= 1" class="px-3 py-1 border rounded disabled:opacity-50">Prev</button>
        <span class="px-2 py-1">Page {{ page }}</span>
        <button @click="page++" :disabled="sessions.length < perPage" class="px-3 py-1 border rounded disabled:opacity-50">Next</button>
      </div>
    </div>
  </div>
</template>
