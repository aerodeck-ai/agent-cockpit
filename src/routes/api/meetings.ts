/**
 * GET /api/meetings
 *
 * Server-side proxy to https://vectos.berl.ai/api/meetings/today.
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

type Meeting = {
  id: string | number
  title: string
  start_time?: string | null
  end_time?: string | null
  attendees?: string[] | null
  action_items?: string[] | null
}

type Source = 'vectos' | 'fixture' | 'timeout' | 'error' | 'no_token' | 'vectos_404'

type MeetingsPayload = {
  meetings: Meeting[]
  source: Source
}

const VECTOS_URL = 'https://vectos.berl.ai'
const UPSTREAM_TIMEOUT_MS = 5_000

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function fixtureTime(hour: number): string {
  return `${todayIso()}T${String(hour).padStart(2, '0')}:00:00.000Z`
}

function fixtureMeetings(): Meeting[] {
  return [
    {
      id: 'fixture-1',
      title: 'Demo standup — proxy fixture',
      start_time: fixtureTime(9),
      end_time: fixtureTime(10),
      attendees: ['Henry', 'Mally'],
      action_items: [],
    },
    {
      id: 'fixture-2',
      title: 'Product review — proxy fixture',
      start_time: fixtureTime(14),
      end_time: fixtureTime(15),
      attendees: ['Henry'],
      action_items: ['Review v2 plan', 'Sign off on design'],
    },
  ]
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

function respond(payload: MeetingsPayload): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
    },
  })
}

export const Route = createFileRoute('/api/meetings')({
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
          return respond({ meetings: fixtureMeetings(), source: 'no_token' })
        }

        const controller = new AbortController()
        const timer = setTimeout(
          () => controller.abort(),
          UPSTREAM_TIMEOUT_MS,
        )

        try {
          const upstream = await fetch(
            `${VECTOS_URL}/api/meetings/today`,
            {
              headers: {
                Accept: 'application/json',
                ...headers,
              },
              signal: controller.signal,
            },
          )

          clearTimeout(timer)

          if (upstream.status === 404) {
            // Endpoint not yet implemented on vectos — return empty set with clear source
            return respond({ meetings: [], source: 'vectos_404' })
          }

          if (!upstream.ok) {
            return respond({ meetings: fixtureMeetings(), source: 'error' })
          }

          const body = await upstream.json()

          const raw: unknown[] = Array.isArray(body)
            ? body
            : (body as Record<string, unknown[]>).meetings ??
              (body as Record<string, unknown[]>).data ??
              []

          return respond({ meetings: raw as Meeting[], source: 'vectos' })
        } catch (err) {
          clearTimeout(timer)
          const isAbort =
            err instanceof Error && err.name === 'AbortError'
          return respond({
            meetings: fixtureMeetings(),
            source: isAbort ? 'timeout' : 'error',
          })
        }
      },
    },
  },
})
