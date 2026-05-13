/**
 * In-memory MCP invocations log.
 *
 * TODO(laminar): when Laminar REST query API is accessible, replace this
 * with a real query to `http://127.0.0.1:5667` filtered to span names
 * matching `tool_call.*` or `mcp.%` with `attributes.mcp_server`.
 * The Laminar OTEL app-server runs at :8000 (gRPC ingestion at :8001)
 * but the query API is only available via the Next.js frontend proxy at :5667,
 * which requires authentication and doesn't expose a stable REST path today.
 *
 * For now, invocations are recorded in memory by the `/api/mcp/test` route
 * (and any future live tool-call interceptor) so the History tab shows
 * real data rather than static stubs.
 */

export type McpInvocationStatus = 'ok' | 'error'

export interface McpInvocation {
  id: string
  server: string
  tool: string
  status: McpInvocationStatus
  latencyMs: number | null
  calledAt: number // unix ms
  error?: string
}

const RING_SIZE = 500
const ring: Array<McpInvocation> = []
let seq = 0

function makeId(): string {
  return `inv-${Date.now().toString(36)}-${(seq++).toString(36)}`
}

export function recordInvocation(
  entry: Omit<McpInvocation, 'id' | 'calledAt'>,
): McpInvocation {
  const inv: McpInvocation = { ...entry, id: makeId(), calledAt: Date.now() }
  if (ring.length >= RING_SIZE) ring.shift()
  ring.push(inv)
  return inv
}

export interface ListInvocationsParams {
  server?: string
  status?: McpInvocationStatus
  limit?: number
}

export function listInvocations(params: ListInvocationsParams = {}): Array<McpInvocation> {
  const { server, status, limit = 100 } = params
  let items = ring.slice().reverse() // most-recent first
  if (server) items = items.filter((i) => i.server === server)
  if (status) items = items.filter((i) => i.status === status)
  return items.slice(0, Math.min(limit, 200))
}

export function isLaminarConfigured(): boolean {
  return Boolean(process.env.LAMINAR_PROJECT_API_KEY)
}
