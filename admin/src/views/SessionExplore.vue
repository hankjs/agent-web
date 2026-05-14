<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { api, type AgentEventRecord } from '../composables/api'
import {
  safeParse, formatTime, getSide, getLabel, getColor, getIcon,
  type TimelineItem, type ExploreStats,
} from '../components/explore/types'
import ExploreStatsBar from '../components/explore/ExploreStatsBar.vue'
import ExploreTimeline from '../components/explore/ExploreTimeline.vue'
import ExploreSummary from '../components/explore/ExploreSummary.vue'

const route = useRoute()
const sessionId = route.params.id as string

const events = ref<AgentEventRecord[]>([])
const loading = ref(true)

const EXPLORE_TYPES = [
  'explore:thought', 'explore:action', 'explore:status',
  'explore:llm_call', 'explore:tool_call', 'explore:tool_result',
  'explore:observation', 'explore:summary_update',
  'explore:question', 'explore:answer', 'explore:complete',
]

const exploreEvents = computed(() => events.value.filter(e => EXPLORE_TYPES.includes(e.event_type)))

const timeline = computed<TimelineItem[]>(() => {
  return exploreEvents.value.map(ev => {
    const p = safeParse(ev.payload)
    const type = ev.event_type
    return {
      id: ev.id,
      side: getSide(type),
      type,
      label: getLabel(type, p),
      time: formatTime(ev.created_at),
      elapsed_ms: p.elapsed_ms || 0,
      payload: p,
      color: getColor(type),
      icon: getIcon(type),
    }
  })
})

const stats = computed<ExploreStats>(() => {
  const llmCalls = exploreEvents.value.filter(e => e.event_type === 'explore:llm_call')
  const toolCalls = exploreEvents.value.filter(e => e.event_type === 'explore:tool_call')
  const findings = exploreEvents.value.filter(e => e.event_type === 'explore:observation')
    .reduce((acc, ev) => acc + (safeParse(ev.payload).findings?.length || 0), 0)
  const tokensIn = llmCalls.reduce((acc, ev) => acc + (safeParse(ev.payload).tokens_in || 0), 0)
  const tokensOut = llmCalls.reduce((acc, ev) => acc + (safeParse(ev.payload).tokens_out || 0), 0)
  const lastElapsed = exploreEvents.value.length > 0
    ? safeParse(exploreEvents.value[exploreEvents.value.length - 1].payload).elapsed_ms
    : 0
  const completeEv = exploreEvents.value.find(e => e.event_type === 'explore:complete')
  const summary = completeEv ? safeParse(completeEv.payload).summary : null
  return { llmCalls: llmCalls.length, toolCalls: toolCalls.length, findings, tokensIn, tokensOut, lastElapsed, summary }
})

onMounted(async () => {
  try { events.value = await api.sessionEvents(sessionId) }
  finally { loading.value = false }
})
</script>

<template>
  <div class="max-w-5xl">
    <RouterLink to="/explore" class="text-[12px] text-text-tertiary hover:text-text-secondary transition-colors">← 探索</RouterLink>
    <div class="flex items-center gap-3 mt-2 mb-5">
      <h1 class="text-lg font-semibold text-text-primary">Explore Timeline</h1>
      <span class="text-[12px] text-text-tertiary font-mono">{{ sessionId.slice(0, 8) }}</span>
    </div>

    <div v-if="loading" class="py-12 text-center text-[13px] text-text-tertiary">Loading...</div>

    <template v-else-if="timeline.length">
      <ExploreStatsBar :stats="stats" />
      <ExploreTimeline :items="timeline" />
      <ExploreSummary v-if="stats.summary" :summary="stats.summary" />
    </template>

    <div v-else class="py-12 text-center text-[13px] text-text-tertiary">No explore events found for this session</div>
  </div>
</template>
