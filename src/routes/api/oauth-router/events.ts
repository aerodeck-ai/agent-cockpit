/**
 * GET /api/oauth-router/events
 *
 * SSE proxy to oracle:9317/control/events.
 *
 * When OAUTH_ROUTER_URL is not set (G1 not yet deployed), the endpoint sends
 * a single "connected" event and then keepalives — no account-switch events
 * will fire in mock mode (the AccountSwitcher handles optimistic updates
 * locally instead).
 */

import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticatedWithCFAccess } from '../../../server/auth-middleware'
import { isOAuthRouterMocked } from '../../../server/oauth-router-client'

const OAUTH_ROUTER_URL = process.env.OAUTH_ROUTER_URL ?? null

export const Route = createFileRoute('/api/oauth-router/events')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticatedWithCFAccess(request)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          )
        }

        const encoder = new TextEncoder()

        // ── Mock mode: connected + keepalive only ──────────────────────────
        if (isOAuthRouterMocked()) {
          let keepaliveTimer: ReturnType<typeof setInterval> | null = null

          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `event: connected\ndata: ${JSON.stringify({ mock: true, ts: Date.now() })}\n\n`,
                ),
              )
              keepaliveTimer = setInterval(() => {
                try {
                  controller.enqueue(encoder.encode(`: keepalive\n\n`))
                } catch {
                  // stream closed
                }
              }, 15_000)
            },
            cancel() {
              if (keepaliveTimer) clearInterval(keepaliveTimer)
            },
          })

          return new Response(stream, {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache, no-store',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
            },
          })
        }

        // ── Real mode: proxy upstream SSE ─────────────────────────────────
        let upstreamRes: Response
        try {
          upstreamRes = await fetch(`${OAUTH_ROUTER_URL}/control/events`, {
            headers: { Accept: 'text/event-stream' },
            // Pass CF Access identity downstream so oracle can audit
            ...(request.headers.get('cf-access-authenticated-user-email')
              ? {
                  headers: {
                    Accept: 'text/event-stream',
                    'cf-access-authenticated-user-email':
                      request.headers.get(
                        'cf-access-authenticated-user-email',
                      ) ?? '',
                  },
                }
              : {}),
          })
        } catch {
          // Fallback: return connected + keepalive if upstream is gone
          let keepaliveTimer: ReturnType<typeof setInterval> | null = null
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `event: connected\ndata: ${JSON.stringify({ fallback: true, ts: Date.now() })}\n\n`,
                ),
              )
              keepaliveTimer = setInterval(() => {
                try {
                  controller.enqueue(encoder.encode(`: keepalive\n\n`))
                } catch {
                  // closed
                }
              }, 15_000)
            },
            cancel() {
              if (keepaliveTimer) clearInterval(keepaliveTimer)
            },
          })
          return new Response(stream, {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache, no-store',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
            },
          })
        }

        if (!upstreamRes.body) {
          return new Response('No upstream body', { status: 502 })
        }

        return new Response(upstreamRes.body, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-store',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        })
      },
    },
  },
})
