/**
 * GET /api/goal/list
 *
 * Returns active + recent goal_sessions (last 24h).
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { listGoalSessions } from '../../../server/goal-sessions-store'

export const Route = createFileRoute('/api/goal/list')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const sessions = listGoalSessions()
          return json({ sessions })
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          return json({ error: msg, sessions: [] }, { status: 200 })
        }
      },
    },
  },
})
