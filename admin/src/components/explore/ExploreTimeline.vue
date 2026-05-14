<script setup lang="ts">
import ExploreTimelineCard from './ExploreTimelineCard.vue'
import type { TimelineItem } from './types'

defineProps<{ items: TimelineItem[] }>()
</script>

<template>
  <div class="relative">
    <!-- Center axis -->
    <div class="absolute left-1/2 top-0 bottom-0 w-px bg-border -translate-x-px"></div>

    <!-- Column headers -->
    <div class="grid grid-cols-2 gap-4 mb-3 text-[11px] font-medium text-text-tertiary uppercase tracking-wide">
      <div class="text-right pr-6">User</div>
      <div class="pl-6">ExploreAgent</div>
    </div>

    <!-- Events -->
    <div v-for="item in items" :key="item.id" class="relative grid grid-cols-2 gap-4 mb-1.5">
      <!-- Center dot -->
      <div class="absolute left-1/2 top-2 -translate-x-1/2 z-10">
        <div
          class="w-2.5 h-2.5 rounded-full border-2 border-surface-base"
          :class="{
            'bg-blue-500': item.color === 'blue',
            'bg-indigo-500': item.color === 'indigo',
            'bg-gray-400': item.color === 'gray',
            'bg-green-500': item.color === 'green',
            'bg-purple-500': item.color === 'purple',
            'bg-amber-500': item.color === 'amber',
            'bg-emerald-500': item.color === 'emerald',
            'bg-sky-500': item.color === 'sky',
          }"
        ></div>
      </div>

      <!-- Left column (user) -->
      <div class="flex justify-end pr-5">
        <ExploreTimelineCard v-if="item.side === 'user'" :item="item" side="user" />
      </div>

      <!-- Right column (agent) -->
      <div class="pl-5">
        <ExploreTimelineCard v-if="item.side === 'agent'" :item="item" side="agent" />
      </div>
    </div>
  </div>
</template>
