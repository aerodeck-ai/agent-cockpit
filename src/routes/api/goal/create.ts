/**
 * POST /api/goal/create
 *
 * Rule 7 validator: at least one of cost_ceiling | time_ceiling_hr | henry_bound required.
 * Returns 422 with field-level errors if the constraint isn't met.
 *
 * Body: { goal_text, cost_ceiling?, time_ceiling_hr?, henry_bound?, no_progress?, killed_sentinel? }
 * Returns: { id, status, created_at, ... }
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { createGoalSession } from '../../../server/goal-sessions-store'

export const Route = createFileRoute('/api/goal/create')({
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

        const goal_text = typeof body.goal_text === 'string' ? body.goal_text.trim() : ''
        if (!goal_text) {
          return json(
            { error: 'Validation failed', fields: { goal_text: 'required' } },
            { status: 422 },
          )
        }

        const cost_ceiling =
          typeof body.cost_ceiling === 'number' ? body.cost_ceiling : null
        const time_ceiling_hr =
          typeof body.time_ceiling_hr === 'number' ? body.time_ceiling_hr : null
        const henry_bound = Array.isArray(body.henry_bound)
          ? (body.henry_bound as string[]).filter((x) => typeof x === 'string' && x.trim())
          : null
        const henryBoundPresent = henry_bound !== null && henry_bound.length > 0

        // Rule 7: at least one safety constraint required
        if (cost_ceiling === null && time_ceiling_hr === null && !henryBoundPresent) {
          return json(
            {
              error: 'Rule 7 violation: at least one of cost_ceiling, time_ceiling_hr, or henry_bound is required',
              fields: {
                cost_ceiling: 'at least one safety ceiling required',
                time_ceiling_hr: 'at least one safety ceiling required',
                henry_bound: 'at least one safety ceiling required',
              },
            },
            { status: 422 },
          )
        }

        const no_progress =
          typeof body.no_progress === 'string' ? body.no_progress : null
        const killed_sentinel =
          typeof body.killed_sentinel === 'string' ? body.killed_sentinel : null

        try {
          const session = createGoalSession({
            goal_text,
            cost_ceiling,
            time_ceiling_hr,
            henry_bound: henryBoundPresent ? henry_bound : null,
            no_progress,
            killed_sentinel,
          })
          return json(session, { status: 201 })
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          return json({ error: msg }, { status: 500 })
        }
      },
    },
  },
})
