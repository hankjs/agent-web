/** Shared types and utilities for Explore timeline components */

export type Side = 'user' | 'agent'

export interface TimelineItem {
  id: string
  side: Side
  type: string
  label: string
  time: string
  elapsed_ms: number
  payload: any
  color: string
  icon: string
}

export interface ExploreStats {
  llmCalls: number
  toolCalls: number
  findings: number
  tokensIn: number
  tokensOut: number
  lastElapsed: number
  summary: string | null
}

export function safeParse(payload: string): any {
  try { return JSON.parse(payload) } catch { return {} }
}

export function formatMs(ms: number): string {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

export function getSide(type: string): Side {
  if (type === 'explore:answer' || type === 'explore:question') return 'user'
  return 'agent'
}

export function getLabel(type: string, p: any): string {
  switch (type) {
    case 'explore:thought': return `思考: ${(p.prompt_preview || '').slice(0, 60)}`
    case 'explore:action': return `决策: ${p.action} ${p.reasoning ? '— ' + p.reasoning.slice(0, 80) : ''}`
    case 'explore:status': return p.message || 'status'
    case 'explore:llm_call': return `LLM [${p.phase}] ${p.tokens_in}→${p.tokens_out} tok, ${p.latency_ms}ms`
    case 'explore:tool_call': return `调用 ${p.tool_name}: ${JSON.stringify(p.input || {}).slice(0, 100)}`
    case 'explore:tool_result': return `${p.tool_name} ${p.is_error ? '❌' : '✓'} ${p.output_length} chars, ${p.duration_ms}ms`
    case 'explore:observation': return `发现 ${(p.findings || []).length} 条`
    case 'explore:summary_update': return '摘要压缩'
    case 'explore:question': return `提问 (${(p.questions || []).length} 题)`
    case 'explore:answer': return `回答: ${(p.content || '').slice(0, 100)}`
    case 'explore:complete': return `完成: ${p.title || ''}`
    default: return type
  }
}

export function getColor(type: string): string {
  switch (type) {
    case 'explore:thought': case 'explore:action': return 'blue'
    case 'explore:llm_call': return 'indigo'
    case 'explore:tool_call': case 'explore:tool_result': return 'gray'
    case 'explore:observation': return 'green'
    case 'explore:summary_update': return 'purple'
    case 'explore:question': case 'explore:answer': return 'amber'
    case 'explore:complete': return 'emerald'
    case 'explore:status': return 'sky'
    default: return 'gray'
  }
}

export function getIcon(type: string): string {
  switch (type) {
    case 'explore:thought': return '💭'
    case 'explore:action': return '⚡'
    case 'explore:status': return '📋'
    case 'explore:llm_call': return '🤖'
    case 'explore:tool_call': return '🔧'
    case 'explore:tool_result': return '📄'
    case 'explore:observation': return '🔍'
    case 'explore:summary_update': return '📝'
    case 'explore:question': return '❓'
    case 'explore:answer': return '💬'
    case 'explore:complete': return '✅'
    default: return '•'
  }
}

export function getDetailText(item: TimelineItem): string {
  const p = item.payload
  switch (item.type) {
    case 'explore:tool_call': return JSON.stringify(p.input, null, 2)
    case 'explore:tool_result': return p.output_preview || ''
    case 'explore:observation': return (p.findings || []).map((f: any) => `[${f.topic}] ${f.content} (${f.source})`).join('\n')
    case 'explore:question': return (p.questions || []).map((q: any) => {
      const opts = (q.options || []).map((o: any, j: number) => {
        if (typeof o === 'string') return `    ${j + 1}. ${o}`
        return `    ${j + 1}. ${o.label}${o.description ? ' — ' + o.description : ''}`
      }).join('\n')
      return `[${q.header || ''}] ${q.question}\n${opts}`
    }).join('\n\n')
    case 'explore:action': return `reasoning: ${p.reasoning}\naction: ${p.action}\nparams: ${JSON.stringify(p.params, null, 2)}`
    case 'explore:summary_update': return `Before:\n${(p.before || '').slice(0, 300)}\n\nAfter:\n${(p.after || '').slice(0, 300)}`
    case 'explore:llm_call': return `phase: ${p.phase}, round: ${p.round ?? '-'}, tools: ${p.tools_count}`
    default: return JSON.stringify(p, null, 2)
  }
}

export function getRawText(item: TimelineItem): string {
  const info: any = {
    event_type: item.type,
    payload: item.payload,
  }
  if (item.type === 'explore:llm_call') {
    info.api = '/api/llm/completion'
    info.request = { system: '...', messages: '...', tools: `[${item.payload.tools_count} tools]`, max_tokens: 4096 }
    info.response = { tokens_in: item.payload.tokens_in, tokens_out: item.payload.tokens_out, latency_ms: item.payload.latency_ms, phase: item.payload.phase }
  } else if (item.type === 'explore:tool_call') {
    info.api = item.payload.local ? 'tauri://tool_*' : '/api/llm/tool-exec'
    info.request = { tool: item.payload.tool_name, input: item.payload.input, work_dir: '...' }
  } else if (item.type === 'explore:tool_result') {
    info.api = item.payload.local ? 'tauri://tool_*' : '/api/llm/tool-exec'
    info.response = { content: item.payload.output_preview, is_error: item.payload.is_error, duration_ms: item.payload.duration_ms, output_length: item.payload.output_length }
  }
  return JSON.stringify(info, null, 2)
}
