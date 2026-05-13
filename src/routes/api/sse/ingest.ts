/**
 * POST /api/sse/ingest
 *
 * Receives a HookEvent JSON body from the claude-event-emitter.py hook
 * and publishes it to the in-process event bus so all connected SSE
 * clients at /api/sse/events receive it immediately.
 *
 * Authentication: shared secret via X-Cockpit-Ingest-Token header.
 * Set COCKPIT_INGEST_TOKEN in .env. If unset, endpoint is disabled.
 *
 * This endpoint is used when the cockpit runs on a remote host (Oracle)
 * and the Claude Code hooks fire on a different machine (Mac).
 * The emitter posts here directly instead of writing JSONL locally.
 *
 * Usage in claude-event-emitter.py:
 *   COCKPIT_INGEST_URL=https://atc-dev.berl.ai/api/sse/ingest
 *   COCKPIT_INGEST_TOKEN=<token>
 */

import { createFileRoute } from '@tanstack/react-router'
import { eventBus } from './event-bus'

export const Route = createFileRoute('/api/sse/ingest')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env.COCKPIT_INGEST_TOKEN
        if (!token) {
          return new Response(
            JSON.stringify({ error: 'Ingest endpoint disabled (COCKPIT_INGEST_TOKEN not set)' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          )
        }

        const authHeader = request.headers.get('x-cockpit-ingest-token')
        if (authHeader !== token) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        eventBus.emit(body as Record<string, unknown>)

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
