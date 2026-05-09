const TOKEN_KEY = 'hank_token'

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  const res = await fetch(url, { ...options, headers })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return res.json()
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  per_page: number
}

export interface Session {
  id: string
  title: string
  provider: string
  model: string
  created_at: string
  updated_at: string
}

export interface AgentMetric {
  id: string
  session_id: string
  input_tokens: number
  output_tokens: number
  latency_ms: number
  model: string
  provider: string
  created_at: string
}

export interface ToolExecution {
  id: string
  session_id: string
  tool_name: string
  duration_ms: number
  is_error: boolean
  created_at: string
}

export interface MetricsOverview {
  total_input_tokens: number
  total_output_tokens: number
  avg_latency_ms: number
  total_llm_calls: number
  tool_error_count: number
  tool_total_count: number
}

export interface PromptTemplate {
  id: string
  name: string
  content: string
  version: number
  created_at: string
}

export interface DbMessage {
  id: string
  session_id: string
  role: string
  content: string
  parent_id: string | null
  created_at: string
}

export const api = {
  sessions(page = 1, perPage = 20, search = '') {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) })
    if (search) params.set('search', search)
    return request<PaginatedResponse<Session>>(`/api/admin/sessions?${params}`)
  },

  sessionReplay(id: string) {
    return request<{ messages: DbMessage[]; metrics: AgentMetric[]; tool_executions: ToolExecution[] }>(
      `/api/admin/sessions/${id}/replay`
    )
  },

  metricsOverview() {
    return request<MetricsOverview>('/api/admin/metrics/overview')
  },

  metricsBySession(id: string) {
    return request<{ metrics: AgentMetric[]; tool_executions: ToolExecution[] }>(
      `/api/admin/metrics/by-session/${id}`
    )
  },

  listPromptTemplates() {
    return request<PromptTemplate[]>('/api/admin/prompt-templates')
  },

  createPromptTemplate(name: string, content: string) {
    return request<{ id: string }>('/api/admin/prompt-templates', {
      method: 'POST',
      body: JSON.stringify({ name, content }),
    })
  },

  replay(sessionId: string, opts: { prompt_template_id?: string; system_prompt?: string }) {
    return fetch('/api/admin/replay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: JSON.stringify({ session_id: sessionId, ...opts }),
    })
  },
}
