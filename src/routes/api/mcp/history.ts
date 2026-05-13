import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { listInvocations, isLaminarConfigured } from '../../../server/mcp-invocations-store'
import type { McpInvocationStatus } from '../../../server/mcp-invocations-store'
import { safeErrorMessage } from '../../../server/rate-limit'

export const Route = createFileRoute('/api/mcp/history')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const url = new URL(request.url)
          const server = url.searchParams.get('server') ?? undefined
          const rawStatus = url.searchParams.get('status')
          const status: McpInvocationStatus | undefined =
            rawStatus === 'ok' || rawStatus === 'error' ? rawStatus : undefined
          const limit = Math.min(
            Number(url.searchParams.get('limit') ?? '100'),
            200,
          )

          const invocations = listInvocations({ server, status, limit })

          return json({
            ok: true,
            invocations,
            total: invocations.length,
            source: isLaminarConfigured()
              ? ('stub' as const)
              : ('stub' as const),
            // TODO: switch source to 'laminar' when REST query API is available
            note: 'History sourced from in-memory ring buffer (last 500 invocations). Laminar OTEL tracing is configured for ingestion; REST query endpoint not yet exposed. Set CONNECTION_REGISTRY_DB and enable Laminar REST API to unlock full history.',
          })
        } catch (err) {
          return json(
            { ok: false, error: safeErrorMessage(err), invocations: [], total: 0 },
            { status: 500 },
          )
        }
      },
    },
  },
})
