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

function exportContext() {
  const evs = exploreEvents.value
  if (!evs.length) return

  const lines: string[] = []
  lines.push(`# Explore Agent Session Context`)
  lines.push(`> 本文档是 Explore Agent 的完整运行上下文，用于帮助 AI 理解该 session 的 prompt 设计和 loop 编排。`)
  lines.push('')
  lines.push(`Session ID: ${sessionId}`)
  lines.push(`Export Time: ${new Date().toISOString()}`)
  lines.push('')

  // ===== 架构说明 =====
  lines.push(`## 1. Agent 架构概述`)
  lines.push('')
  lines.push(`Explore Agent 是一个客户端驱动的多阶段 AI 探索循环，用于在编码前充分理解需求和代码现状。`)
  lines.push('')
  lines.push(`### 核心循环 (React Loop)`)
  lines.push('```')
  lines.push(`while (turnCount < HARD_MAX_READS && !cancelled):`)
  lines.push(`  1. Planner Step → 决定下一步行动 (read_code / ask_user / confirm_requirement / finalize)`)
  lines.push(`  2. Execute Action:`)
  lines.push(`     - read_code → Reader Step (最多 5 轮工具调用)`)
  lines.push(`     - ask_user → 暂停等待用户回答`)
  lines.push(`     - confirm_requirement → 提交文档给用户确认`)
  lines.push(`     - finalize → 生成最终摘要，结束`)
  lines.push(`  3. Summarize → 当 findings token 超阈值(800)时压缩摘要`)
  lines.push(`  4. Loop back to Planner`)
  lines.push('```')
  lines.push('')
  lines.push(`### 关键参数`)
  lines.push(`- HARD_MAX_READS = 20 (最大总轮次)`)
  lines.push(`- MAX_FULL_ROUNDS = 3 (Reader 消息窗口保留轮数，超出则 trim)`)
  lines.push(`- MAX_TOOL_ROUNDS = 5 (单次 read_code 最大工具调用轮数)`)
  lines.push(`- summarizeThreshold = 800 tokens (触发摘要压缩)`)
  lines.push(`- 深度控制: quick=4轮, standard=8轮, deep=15轮`)
  lines.push('')

  // ===== Prompt 设计 =====
  lines.push(`## 2. Prompt 设计`)
  lines.push('')
  lines.push(`### Planner Prompt (决策层)`)
  lines.push(`角色: JSON 输出机器，只返回合法 JSON`)
  lines.push(`输入: 当前摘要 + 用户输入 + 进度信息(轮次/发现数/耗时/已读文件/文档进度)`)
  lines.push(`输出: { reasoning, action, params }`)
  lines.push(`核心原则:`)
  lines.push(`  - 代码事实靠阅读，用户意图靠提问`)
  lines.push(`  - 第一轮必须 read_code`)
  lines.push(`  - 带方案提问（基于调查结果给选项）`)
  lines.push(`  - 收敛规则: 剩余≤2轮优先收敛; 重叠目标换方向; 文档大部分填充则 confirm`)
  lines.push('')
  lines.push(`### Reader Prompt (执行层)`)
  lines.push(`角色: 代码阅读助手，只读不改`)
  lines.push(`输入: objective + work_dir`)
  lines.push(`工作方式: 先 glob 了解结构 → 针对性 read_file → report_findings`)
  lines.push(`韧性规则: glob 空结果时上移目录/放宽模式/改用 search`)
  lines.push(`效率规则: 3-5 次工具调用完成，超 5 次总结已知内容`)
  lines.push('')
  lines.push(`### Summarizer Prompt (压缩层)`)
  lines.push(`触发: findings token 超过阈值`)
  lines.push(`作用: 合并重复发现，去除冗余，保留关键事实`)
  lines.push('')

  // ===== 工具定义 =====
  lines.push(`## 3. 可用工具`)
  lines.push('')
  lines.push(`### Reader 阶段工具 (只读)`)
  lines.push(`| 工具 | 用途 |`)
  lines.push(`|------|------|`)
  lines.push(`| read_file | 读取文件内容 (path, offset?, limit?) |`)
  lines.push(`| search | ripgrep 搜索 (pattern, path?, glob?, ignore_case?) |`)
  lines.push(`| glob | 文件匹配 (pattern, path?) |`)
  lines.push(`| report_findings | 报告结构化发现 [{topic, content, source}] |`)
  lines.push(`| bash | 仅限 curl 获取网页/API 文档 |`)
  lines.push(`| AskUserQuestion | 向用户提问 [{header, question, options}] |`)
  lines.push('')

  // ===== 统计 =====
  const s = stats.value
  lines.push(`## 4. 本次运行统计`)
  lines.push('')
  lines.push(`| 指标 | 值 |`)
  lines.push(`|------|------|`)
  lines.push(`| LLM 调用次数 | ${s.llmCalls} |`)
  lines.push(`| 工具调用次数 | ${s.toolCalls} |`)
  lines.push(`| 发现条数 | ${s.findings} |`)
  lines.push(`| 输入 Tokens | ${s.tokensIn} |`)
  lines.push(`| 输出 Tokens | ${s.tokensOut} |`)
  lines.push(`| 总耗时 | ${s.lastElapsed}ms |`)
  lines.push('')

  // ===== 完整事件流 =====
  lines.push(`## 5. 完整事件流 (Loop Trace)`)
  lines.push('')

  let currentRound = -1
  let currentTurn = -1
  for (const ev of evs) {
    const p = safeParse(ev.payload)
    const type = ev.event_type

    // 标记 turn 分界
    if (p.turn !== undefined && p.turn !== currentTurn) {
      currentTurn = p.turn
      lines.push('')
      lines.push(`--- Turn ${currentTurn} ---`)
      lines.push('')
    }

    // 标记 round 分界 (reader 内部)
    if (type === 'explore:llm_call' && p.phase === 'reader' && p.round !== undefined && p.round !== currentRound) {
      currentRound = p.round
      lines.push(`  [Reader Round ${currentRound}]`)
    }

    switch (type) {
      case 'explore:thought':
        lines.push(`[Planner Input] ${p.prompt_preview || ''}`)
        break
      case 'explore:action':
        lines.push(`[Planner Decision] action="${p.action}"`)
        lines.push(`  reasoning: ${p.reasoning || ''}`)
        if (p.params) lines.push(`  params: ${JSON.stringify(p.params)}`)
        break
      case 'explore:llm_call': {
        const extra: string[] = []
        if (p.system) extra.push(`system(${p.system.length} chars)`)
        if (p.messages) extra.push(`messages(${typeof p.messages === 'string' ? p.messages.length : JSON.stringify(p.messages).length} chars)`)
        lines.push(`[LLM Call] phase=${p.phase}, round=${p.round ?? '-'}, tools=${p.tools_count}, tokens=${p.tokens_in}→${p.tokens_out}, latency=${p.latency_ms}ms ${extra.join(', ')}`)
        // 输出 system prompt 内容（如果有）
        if (p.system && p.phase === 'planner') {
          lines.push(`  system_prompt: "${p.system}"`)
        }
        if (p.system && p.phase === 'reader') {
          lines.push(`  reader_system: ${p.system.slice(0, 300)}${p.system.length > 300 ? '...' : ''}`)
        }
        break
      }
      case 'explore:tool_call':
        lines.push(`[Tool Call] ${p.tool_name}(${JSON.stringify(p.input || {})})`)
        break
      case 'explore:tool_result':
        lines.push(`[Tool Result] ${p.tool_name} → ${p.is_error ? 'ERROR' : 'OK'} (${p.duration_ms}ms, ${p.output_length} chars)`)
        if (p.output_preview) lines.push(`  preview: ${p.output_preview.slice(0, 300)}`)
        break
      case 'explore:observation':
        lines.push(`[Findings Reported]`)
        for (const f of (p.findings || [])) {
          lines.push(`  - [${f.topic}] ${f.content} (${f.source})`)
        }
        break
      case 'explore:summary_update':
        lines.push(`[Summary Compressed]`)
        if (p.before) lines.push(`  before(${p.before.length} chars): ${p.before.slice(0, 150)}...`)
        if (p.after) lines.push(`  after(${p.after.length} chars): ${p.after.slice(0, 300)}`)
        break
      case 'explore:question':
        lines.push(`[Ask User]`)
        for (const q of (p.questions || [])) {
          lines.push(`  Q[${q.header}]: ${q.question}`)
          for (const o of (q.options || [])) {
            const label = typeof o === 'string' ? o : o.label
            const desc = typeof o === 'string' ? '' : (o.description ? ` — ${o.description}` : '')
            lines.push(`    - ${label}${desc}`)
          }
        }
        break
      case 'explore:answer':
        lines.push(`[User Answer] ${p.content || ''}`)
        break
      case 'explore:status':
        lines.push(`[Status] ${p.message || ''}`)
        break
      case 'explore:complete':
        lines.push(`[Explore Complete] title: "${p.title || ''}"`)
        if (p.summary) lines.push(`  summary:\n${p.summary}`)
        break
    }
  }

  // ===== 最终摘要 =====
  if (s.summary) {
    lines.push('')
    lines.push(`## 6. Final Summary`)
    lines.push('')
    lines.push(s.summary)
  }

  const content = lines.join('\n')
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `explore-context-${sessionId.slice(0, 8)}.md`
  a.click()
  URL.revokeObjectURL(url)
}

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
      <button
        v-if="!loading && timeline.length"
        @click="exportContext"
        class="ml-auto px-3 py-1 text-[12px] rounded bg-surface-secondary hover:bg-surface-tertiary text-text-secondary transition-colors"
      >导出上下文</button>
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
