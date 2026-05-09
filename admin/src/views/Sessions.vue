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
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-lg font-semibold text-text-primary">Sessions</h1>
      <input
        v-model="search"
        placeholder="Search..."
        class="bg-transparent border border-border rounded-md px-3 py-1.5 text-[13px] w-56 placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors"
      />
    </div>

    <div class="text-[12px] text-text-tertiary grid grid-cols-[1fr_80px_100px_140px_100px] gap-2 px-2 pb-2 border-b border-border-subtle font-medium">
      <span>Title</span>
      <span>User</span>
      <span>Provider</span>
      <span>Model</span>
      <span class="text-right">Updated</span>
    </div>

    <div class="divide-y divide-border-subtle">
      <RouterLink
        v-for="s in sessions"
        :key="s.id"
        :to="`/sessions/${s.id}`"
        class="grid grid-cols-[1fr_80px_100px_140px_100px] gap-2 items-center px-2 py-2.5 -mx-2 rounded-md hover:bg-hover transition-colors duration-100 cursor-pointer"
      >
        <span class="text-[13px] text-text-primary truncate">{{ s.title || s.id.slice(0, 8) }}</span>
        <span class="text-[12px] text-text-tertiary truncate">{{ s.username || '-' }}</span>
        <span class="text-[12px] text-text-tertiary">{{ s.provider }}</span>
        <span class="text-[12px] text-text-tertiary truncate">{{ s.model }}</span>
        <span class="text-[12px] text-text-tertiary text-right">{{ new Date(s.updated_at).toLocaleDateString() }}</span>
      </RouterLink>
    </div>

    <div v-if="!sessions.length" class="py-12 text-center text-[13px] text-text-tertiary">No sessions found</div>

    <div class="flex items-center justify-between mt-6 text-[12px] text-text-tertiary">
      <span>{{ total }} total</span>
      <div class="flex items-center gap-1">
        <button
          @click="page = Math.max(1, page - 1)"
          :disabled="page <= 1"
          class="px-2.5 py-1 rounded hover:bg-hover disabled:opacity-30 transition-colors"
        >←</button>
        <span class="px-2 tabular-nums">{{ page }}</span>
        <button
          @click="page++"
          :disabled="sessions.length < perPage"
          class="px-2.5 py-1 rounded hover:bg-hover disabled:opacity-30 transition-colors"
        >→</button>
      </div>
    </div>
  </div>
</template>
