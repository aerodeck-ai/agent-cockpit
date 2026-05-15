/**
 * POST /api/goal/pause
 *
 * Body: { id }
 * Updates status='paused', paused_at=now.
 * Actual SIGTERM is hook-side; this records intent.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { pauseGoalSession } from '../../../server/goal-sessions-store'

export const Route = createFileRoute('/api/goal/pause')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        let body: Record<string, unknown>
        try {
          body = (await request.json()) as Record<string, unknown>
        } catch {
          return json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const id = typeof body.id === 'string' ? body.id.trim() : ''
        if (!id) {
          return json({ error: 'id required' }, { status: 400 })
        }

        const session = pauseGoalSession(id)
        if (!session) {
          return json({ error: 'Not found or failed to update' }, { status: 404 })
        }

        return json({
          session,
          handoff_note: `Goal ${id} paused at ${session.paused_at}. Review henry_bound items and resume when ready.`,
        })
      },
    },
  },
})
