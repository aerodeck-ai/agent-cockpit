/**
 * GET /api/goal/$id
 *
 * Returns a single goal session by ID.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getGoalSession } from '../../../server/goal-sessions-store'

export const Route = createFileRoute('/api/goal/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const { id } = params
        if (!id) {
          return json({ error: 'id required' }, { status: 400 })
        }
        const session = getGoalSession(id)
        if (!session) {
          return json({ error: 'Not found' }, { status: 404 })
        }
        return json(session)
      },
    },
  },
})
