<script setup lang="ts">
import { ref } from 'vue'
import { formatMs, getDetailText, getRawText, type TimelineItem } from './types'
import JsonBlock from './JsonBlock.vue'

defineProps<{
  item: TimelineItem
  side: 'user' | 'agent'
}>()

const showDetail = ref(false)
const showRaw = ref(false)

function toggleDetail(ev: Event) {
  ev.stopPropagation()
  showDetail.value = !showDetail.value
}
function toggleRaw(ev: Event) {
  ev.stopPropagation()
  showRaw.value = !showRaw.value
}
</script>

<template>
  <div class="max-w-full rounded-lg px-3 py-2 border transition-all hover:border-border"
    :class="(showDetail || showRaw) ? 'border-border bg-surface-raised/50' : 'border-transparent'"
  >
    <!-- Header row -->
    <div class="flex items-center gap-1.5" :class="side === 'user' ? 'justify-end' : ''">
      <template v-if="side === 'user'">
        <button @click="toggleDetail"
          class="text-[9px] px-1 py-0.5 rounded border transition-colors cursor-pointer"
          :class="showDetail ? 'text-accent border-accent' : 'border-border-subtle text-text-tertiary hover:text-accent hover:border-accent'"
        >detail</button>
        <button @click="toggleRaw"
          class="text-[9px] px-1 py-0.5 rounded border transition-colors cursor-pointer"
          :class="showRaw ? 'text-accent border-accent' : 'border-border-subtle text-text-tertiary hover:text-accent hover:border-accent'"
        >raw</button>
        <span class="text-[10px] text-text-tertiary tabular-nums">{{ item.time }}</span>
        <span class="text-[10px] text-text-tertiary tabular-nums" v-if="item.elapsed_ms">+{{ formatMs(item.elapsed_ms) }}</span>
      </template>
      <template v-else>
        <span class="text-[10px] text-text-tertiary tabular-nums">{{ item.time }}</span>
        <span class="text-[10px] text-text-tertiary tabular-nums" v-if="item.elapsed_ms">+{{ formatMs(item.elapsed_ms) }}</span>
        <button @click="toggleDetail"
          class="text-[9px] px-1 py-0.5 rounded border transition-colors cursor-pointer"
          :class="showDetail ? 'text-accent border-accent' : 'border-border-subtle text-text-tertiary hover:text-accent hover:border-accent'"
        >detail</button>
        <button @click="toggleRaw"
          class="text-[9px] px-1 py-0.5 rounded border transition-colors cursor-pointer"
          :class="showRaw ? 'text-accent border-accent' : 'border-border-subtle text-text-tertiary hover:text-accent hover:border-accent'"
        >raw</button>
      </template>
    </div>

    <!-- Label -->
    <div class="text-[12px] text-text-primary mt-0.5" :class="side === 'user' ? 'text-right' : ''">
      {{ item.icon }} {{ item.label }}
    </div>

    <!-- Detail panel -->
    <JsonBlock v-if="showDetail" :content="getDetailText(item)" max-height="12rem" />

    <!-- Raw panel -->
    <JsonBlock v-if="showRaw" :content="getRawText(item)" max-height="15rem" />
  </div>
</template>
