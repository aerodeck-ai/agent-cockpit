import { useQuery } from '@tanstack/react-query'

export type HealthStatus = 'green' | 'yellow' | 'red' | 'unknown'

export interface ServerHealth {
  name: string
  status: HealthStatus
  lastOkAt: string | null
  lastFailAt: string | null
  consecutiveFailures: number
}

export interface McpHealthResponse {
  ok: boolean
  healths: Array<ServerHealth>
  total: number
  cacheTtlMs: number
}

export function useMcpHealth() {
  return useQuery({
    queryKey: ['mcp', 'health'],
    queryFn: async (): Promise<McpHealthResponse> => {
      const res = await fetch('/api/mcp/health')
      if (!res.ok) throw new Error(`MCP health failed (${res.status})`)
      return (await res.json()) as McpHealthResponse
    },
    staleTime: 55_000,
    refetchInterval: 60_000,
  })
}

export function useServerHealth(name: string) {
  const query = useMcpHealth()
  const health = query.data?.healths.find((h) => h.name === name) ?? null
  return { health, isLoading: query.isLoading }
}
