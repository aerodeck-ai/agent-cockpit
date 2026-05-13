/**
 * GET /api/briefing
 *
 * Server-side proxy to https://vectos.berl.ai/api/briefing.
 * Bypasses CORS: vectos does not send Access-Control-Allow-Origin, so
 * browser requests are blocked. This endpoint fetches server-side and
 * returns the data wrapped with a `source` discriminant.
 *
 * Auth: uses CF Access service token (CF_ACCESS_CLIENT_ID /
 * CF_ACCESS_CLIENT_SECRET) when present in env. Falls back to a fixture
 * so the UI keeps rendering even when credentials are absent.
 *
 * Rules:
 *  - Always returns HTTP 200 — never propagates vectos error codes.
 *  - 30-second Cache-Control so pollers don't hammer vectos.
 *  - 5-second upstream timeout; returns source:"timeout" fixture on breach.
 *  - CF headers are never echoed back to the client.
 *  - If vectos returns 404 (endpoint not yet built), returns
 *    { briefing: null, source: "vectos_404" }.
 */

import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticatedWithCFAccess } from '../../server/auth-middleware'

type BriefingItem = {
  label: string
  value: string
}

type Briefing = {
  summary: string
  items: BriefingItem[]
}

type Source =
  | 'vectos'
  | 'fixture'
  | 'timeout'
  | 'error'
  | 'no_token'
  | 'vectos_404'

type BriefingPayload = {
  briefing: Briefing | null
  source: Source
}

const VECTOS_URL = 'https://vectos.berl.ai'
const UPSTREAM_TIMEOUT_MS = 5_000

const FIXTURE_BRIEFING: Briefing = {
  summary: 'Demo briefing — proxy fixture (no CF service token configured)',
  items: [
    { label: 'Active agents', value: '3' },
    { label: 'Pending approvals', value: '2' },
    { label: 'Open milestones', value: '3' },
  ],
}

function cfHeaders(): Record<string, string> | null {
  const id = process.env.CF_ACCESS_CLIENT_ID
  const secret = process.env.CF_ACCESS_CLIENT_SECRET
  if (!id || !secret) return null
  return {
    'CF-Access-Client-Id': id,
    'CF-Access-Client-Secret': secret,
  }
}

function respond(payload: BriefingPayload): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
    },
  })
}

export const Route = createFileRoute('/api/briefing')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticatedWithCFAccess(request)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const headers = cfHeaders()
        if (!headers) {
          return respond({ briefing: FIXTURE_BRIEFING, source: 'no_token' })
        }

        const controller = new AbortController()
        const timer = setTimeout(
          () => controller.abort(),
          UPSTREAM_TIMEOUT_MS,
        )

        try {
          const upstream = await fetch(`${VECTOS_URL}/api/briefing`, {
            headers: {
              Accept: 'application/json',
              ...headers,
            },
            signal: controller.signal,
          })

          clearTimeout(timer)

          if (upstream.status === 404) {
            return respond({ briefing: null, source: 'vectos_404' })
          }

          if (!upstream.ok) {
            return respond({ briefing: FIXTURE_BRIEFING, source: 'error' })
          }

          const body = await upstream.json()

          // vectos may return { briefing: {...} } or the object directly
          const briefingData: Briefing =
            (body as { briefing?: Briefing }).briefing ?? (body as Briefing)

          return respond({ briefing: briefingData, source: 'vectos' })
        } catch (err) {
          clearTimeout(timer)
          const isAbort =
            err instanceof Error && err.name === 'AbortError'
          return respond({
            briefing: FIXTURE_BRIEFING,
            source: isAbort ? 'timeout' : 'error',
          })
        }
      },
    },
  },
})
