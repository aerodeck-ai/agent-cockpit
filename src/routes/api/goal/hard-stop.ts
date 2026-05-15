/**
 * POST /api/goal/hard-stop
 *
 * Double-click gate: requires { id, confirm: true }.
 * If confirm !== true → 400.
 * Updates status='killed', killed_at=now.
 * Actual SIGTERM is hook-side; this records intent + emits event for Stop hook.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { killGoalSession } from '../../../server/goal-sessions-store'

export const Route = createFileRoute('/api/goal/hard-stop')({
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

        // Double-click gate
        if (body.confirm !== true) {
          return json(
            { error: 'Double-click gate: confirm must be true' },
            { status: 400 },
          )
        }

        const id = typeof body.id === 'string' ? body.id.trim() : ''
        if (!id) {
          return json({ error: 'id required' }, { status: 400 })
        }

        const session = killGoalSession(id)
        if (!session) {
          return json({ error: 'Not found or failed to update' }, { status: 404 })
        }

        return json({
          session,
          stop_signal: {
            goal_id: id,
            killed_at: session.killed_at,
            action: 'HARD_STOP',
            instruction: 'Stop hook should SIGTERM the associated Claude process for this goal_id.',
          },
        })
      },
    },
  },
})
