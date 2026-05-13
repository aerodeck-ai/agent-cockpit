import { useQuery } from '@tanstack/react-query'

export type McpInvocationStatus = 'ok' | 'error'

export interface McpInvocation {
  id: string
  server: string
  tool: string
  status: McpInvocationStatus
  latencyMs: number | null
  calledAt: number
  error?: string
}

export interface McpHistoryResponse {
  ok: boolean
  invocations: Array<McpInvocation>
  total: number
  source: 'stub' | 'laminar'
  note?: string
}

export interface UseMcpHistoryParams {
  server?: string
  status?: McpInvocationStatus
  limit?: number
  enabled?: boolean
}

export function useMcpHistory(params: UseMcpHistoryParams = {}) {
  const { server, status, limit = 100, enabled = true } = params
  return useQuery({
    queryKey: ['mcp', 'history', { server, status, limit }],
    queryFn: async (): Promise<McpHistoryResponse> => {
      const url = new URL('/api/mcp/history', window.location.origin)
      if (server) url.searchParams.set('server', server)
      if (status) url.searchParams.set('status', status)
      if (limit !== 100) url.searchParams.set('limit', String(limit))
      const res = await fetch(url.pathname + url.search)
      if (!res.ok) throw new Error(`MCP history failed (${res.status})`)
      return (await res.json()) as McpHistoryResponse
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
    enabled,
  })
}
