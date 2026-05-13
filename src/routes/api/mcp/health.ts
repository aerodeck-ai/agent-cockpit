import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { listServerHealths, getServerHealth } from '../../../server/mcp-health-store'
import { safeErrorMessage } from '../../../server/rate-limit'

export const Route = createFileRoute('/api/mcp/health')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const url = new URL(request.url)
          const name = url.searchParams.get('name')

          if (name) {
            const health = getServerHealth(name)
            return json({
              ok: true,
              health,
            })
          }

          const healths = listServerHealths()
          return json({
            ok: true,
            healths,
            total: healths.length,
            cacheTtlMs: 60_000,
          })
        } catch (err) {
          return json(
            { ok: false, error: safeErrorMessage(err), healths: [], total: 0 },
            { status: 500 },
          )
        }
      },
    },
  },
})
