/**
 * POST /api/voice/chat
 *
 * Forwards a voice query to the per-tenant Hermes LLM endpoint and streams
 * the text response back.
 *
 * henry_cos → :8642, mally → :8644 (via tenant-context)
 *
 * Request body: { text: string }
 * Response: text/event-stream of delta chunks, terminated by [DONE]
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getTenantUpstreamForRequest } from '../../../server/tenant-context'

const VOICE_SYSTEM_PROMPT = [
  'You are a voice assistant. Respond in 1–3 short, clear sentences.',
  'No markdown. No bullet points. Write as you would speak aloud.',
  'Spell out numbers and symbols: say "twenty percent" not "20%".',
  'Use natural spoken cadence with commas and periods.',
].join(' ')

export const Route = createFileRoute('/api/voice/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
            status: 401, headers: { 'Content-Type': 'application/json' },
          })
        }

        let body: { text?: string }
        try {
          body = await request.json() as { text?: string }
        } catch {
          return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          })
        }

        const text = typeof body.text === 'string' ? body.text.trim() : ''
        if (!text) {
          return new Response(JSON.stringify({ ok: false, error: 'Missing text' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          })
        }

        const { baseUrl, token } = getTenantUpstreamForRequest(request)

        const hermesResp = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            model: 'default',
            stream: true,
            messages: [
              { role: 'system', content: VOICE_SYSTEM_PROMPT },
              { role: 'user', content: text },
            ],
            max_tokens: 300,
          }),
          signal: AbortSignal.timeout(60_000),
        }).catch((err: unknown) => {
          throw new Error(err instanceof Error ? err.message : 'Hermes unreachable')
        })

        if (!hermesResp.ok) {
          const errBody = await hermesResp.text().catch(() => '')
          return new Response(
            JSON.stringify({ ok: false, error: `Hermes error ${hermesResp.status}: ${errBody}` }),
            { status: 502, headers: { 'Content-Type': 'application/json' } },
          )
        }

        // Pipe the SSE stream back to the client with minimal transformation
        const readable = hermesResp.body
        if (!readable) {
          return new Response(JSON.stringify({ ok: false, error: 'No stream body' }), {
            status: 502, headers: { 'Content-Type': 'application/json' },
          })
        }

        return new Response(readable, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
          },
        })
      },
    },
  },
})
