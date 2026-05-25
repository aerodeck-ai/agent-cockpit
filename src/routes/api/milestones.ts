/**
 * GET /api/milestones
 *
 * Server-side proxy to https://vectos.berl.ai/api/milestones.
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
 */

import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticatedWithCFAccess } from '../../server/auth-middleware'

type Milestone = {
  id: string | number
  title: string
  status?: string | null
  due?: string | null
  target_date?: string | null
  owner?: string | null
}

type Source = 'vectos' | 'fixture' | 'timeout' | 'error' | 'no_token'

type MilestonesPayload = {
  milestones: Milestone[]
  source: Source
}

const VECTOS_URL = 'https://vectos.berl.ai'
const UPSTREAM_TIMEOUT_MS = 5_000

const FIXTURE_MILESTONES: Milestone[] = [
  {
    id: 1,
    title: 'Demo milestone — proxy fixture',
    status: 'in_progress',
    due: '2026-05-20',
    target_date: '2026-05-20',
    owner: 'Henry',
  },
  {
    id: 2,
    title: 'Launch v2 cockpit',
    status: 'planned',
    due: '2026-06-01',
    target_date: '2026-06-01',
    owner: 'Henry',
  },
  {
    id: 3,
    title: 'VectOS public beta',
    status: 'at_risk',
    due: '2026-06-15',
    target_date: '2026-06-15',
    owner: 'Both',
  },
]

function cfHeaders(): Record<string, string> | null {
  // Check vectos-specific token first, then fall back to the generic one
  const id =
    process.env.CF_ACCESS_CLIENT_ID_VECTOS ?? process.env.CF_ACCESS_CLIENT_ID
  const secret =
    process.env.CF_ACCESS_CLIENT_SECRET_VECTOS ?? process.env.CF_ACCESS_CLIENT_SECRET
  if (!id || !secret) return null
  return {
    'CF-Access-Client-Id': id,
    'CF-Access-Client-Secret': secret,
  }
}

function respond(payload: MilestonesPayload): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
    },
  })
}

export const Route = createFileRoute('/api/milestones')({
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
          // No service token — return fixture so the UI keeps rendering
          return respond({ milestones: FIXTURE_MILESTONES, source: 'no_token' })
        }

        const controller = new AbortController()
        const timer = setTimeout(
          () => controller.abort(),
          UPSTREAM_TIMEOUT_MS,
        )

        try {
          const upstream = await fetch(`${VECTOS_URL}/api/milestones`, {
            headers: {
              Accept: 'application/json',
              ...headers,
            },
            signal: controller.signal,
          })

          clearTimeout(timer)

          if (!upstream.ok) {
            return respond({ milestones: FIXTURE_MILESTONES, source: 'error' })
          }

          const body = await upstream.json()

          // vectos may return { milestones: [...] } or { data: [...] } or a bare array
          const raw: unknown[] = Array.isArray(body)
            ? body
            : (body as Record<string, unknown[]>).milestones ??
              (body as Record<string, unknown[]>).data ??
              []

          return respond({
            milestones: raw as Milestone[],
            source: 'vectos',
          })
        } catch (err) {
          clearTimeout(timer)
          const isAbort =
            err instanceof Error && err.name === 'AbortError'
          return respond({
            milestones: FIXTURE_MILESTONES,
            source: isAbort ? 'timeout' : 'error',
          })
        }
      },
    },
  },
})
