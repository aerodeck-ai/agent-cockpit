/**
 * POST /api/hermes/goal
 *
 * Forwards a plan text to the Hermes gateway's goal endpoint. Used by the /build
 * page's [Finalise Plan] button to dispatch a user-approved plan to Hermes for
 * autonomous execution.
 *
 * Body: { plan_text: string, profile?: string, goal_session_id?: string }
 *
 * The endpoint POSTs to ${HERMES_API_URL}/api/goal (defaults to http://127.0.0.1:8642).
 * Returns the Hermes response on success; 502 with a "hermes-goal-not-wired" code if
 * the gateway doesn't expose /api/goal yet (Hermes upstream addition pending).
 *
 * If a goal_session_id is supplied, the dashboard-side goal_sessions row will have
 * its status flipped to 'running' on a successful Hermes forward (via list.ts).
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'

const HERMES_API =
  process.env.HERMES_API_URL || process.env.CLAUDE_API_URL || 'http://127.0.0.1:8642'
const PROBE_TIMEOUT_MS = 8_000

function authHeaders(): Record<string, string> {
  const token = process.env.HERMES_API_TOKEN || process.env.CLAUDE_API_TOKEN || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export const Route = createFileRoute('/api/hermes/goal')({
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

        const planText =
          typeof body.plan_text === 'string' ? body.plan_text.trim() : ''
        if (!planText) {
          return json(
            { error: 'Validation failed', fields: { plan_text: 'required' } },
            { status: 422 },
          )
        }

        const profile = typeof body.profile === 'string' ? body.profile : undefined
        const goalSessionId =
          typeof body.goal_session_id === 'string' ? body.goal_session_id : undefined

        const forwardBody: Record<string, unknown> = {
          goal_text: planText,
          source: 'atc-build-finalise',
        }
        if (profile) forwardBody.profile = profile
        if (goalSessionId) forwardBody.atc_goal_session_id = goalSessionId

        try {
          const res = await fetch(`${HERMES_API}/api/goal`, {
            method: 'POST',
            headers: {
              ...authHeaders(),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(forwardBody),
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          })

          if (res.status === 404 || res.status === 405) {
            return json(
              {
                error: 'hermes-goal-not-wired',
                message:
                  'Hermes gateway does not expose /api/goal yet. The plan text was validated but not dispatched. Wire goals.py POST endpoint in hermes-agent before retrying.',
                hermes_url: HERMES_API,
              },
              { status: 502 },
            )
          }

          const responseText = await res.text()
          let parsed: unknown
          try {
            parsed = JSON.parse(responseText)
          } catch {
            parsed = { raw: responseText }
          }

          if (!res.ok) {
            return json(
              { error: 'hermes-rejected', status: res.status, body: parsed },
              { status: res.status },
            )
          }

          return json({ ok: true, hermes_response: parsed })
        } catch (err) {
          const isTimeout =
            err instanceof Error && err.name === 'TimeoutError'
          return json(
            {
              error: isTimeout ? 'hermes-timeout' : 'hermes-unreachable',
              hermes_url: HERMES_API,
              detail: err instanceof Error ? err.message : 'unknown',
            },
            { status: 503 },
          )
        }
      },
    },
  },
})
