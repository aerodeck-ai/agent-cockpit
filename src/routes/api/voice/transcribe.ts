/**
 * POST /api/voice/transcribe
 *
 * Forwards raw audio bytes to the local MLX Whisper STT server at :8770.
 * Falls back to :8771 (CPU faster-whisper) if :8770 health check fails.
 *
 * Multi-tenancy (F3):
 * - Reads CF Access email header to detect tenant
 * - henry_cos  → VOICE_HENRY_STT_URL (default http://127.0.0.1:8770)
 * - mally      → VOICE_MALLY_STT_URL (default http://mally-mac:8770 via Tailscale)
 * - If Mally's STT URL is unreachable, returns 503 with
 *   { ok: false, voiceUnavailable: true, fallbackMode: "text-only" }
 *   so the UI can show the "Voice not yet provisioned — type your prompt" tile.
 *
 * Request body: raw audio bytes (any content-type; multipart/form-data
 *   with field "audio" OR raw bytes in body).
 * Response: { text: string, backend: string, duration_ms: number }
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated, getCFAccessEmail } from '../../../server/auth-middleware'
import { resolveTenantFromEmail } from '../../../lib/auth/tenants'

// ─── STT URL resolution ────────────────────────────────────────────────────

const STT_HENRY_PRIMARY  = process.env.VOICE_HENRY_STT_URL  ?? 'http://127.0.0.1:8770'
const STT_HENRY_FALLBACK = process.env.VOICE_HENRY_STT_URL_FALLBACK ?? 'http://127.0.0.1:8771'
const STT_MALLY_PRIMARY  = process.env.VOICE_MALLY_STT_URL  ?? 'http://mally-mac:8770'

/**
 * Resolve the STT base URL for the requesting tenant.
 *
 * Returns { base, isMally, provisioned } where `provisioned` is false when
 * Mally's STT URL env var is absent or the service is unreachable — the
 * caller should respond with a text-only fallback hint instead of 502.
 */
async function resolveSttBase(request: Request): Promise<{
  base: string
  isMally: boolean
  provisioned: boolean
}> {
  const email = getCFAccessEmail(request)
  const tenantInfo = email ? resolveTenantFromEmail(email) : null
  const isMally = tenantInfo?.tenant === 'mally'

  if (isMally) {
    // Only attempt Mally's STT if the env var is explicitly set — if it's the
    // default sentinel value we treat it as "not provisioned yet".
    const mallyUrlConfigured = !!process.env.VOICE_MALLY_STT_URL
    if (!mallyUrlConfigured) {
      return { base: STT_MALLY_PRIMARY, isMally: true, provisioned: false }
    }
    // Quick health probe with 2 s timeout.
    try {
      const res = await fetch(`${STT_MALLY_PRIMARY}/health`, {
        signal: AbortSignal.timeout(2_000),
      })
      if (res.ok) return { base: STT_MALLY_PRIMARY, isMally: true, provisioned: true }
    } catch {
      // Tailscale peer offline or service not running.
    }
    return { base: STT_MALLY_PRIMARY, isMally: true, provisioned: false }
  }

  // Henry / default: try primary then fallback.
  try {
    const res = await fetch(`${STT_HENRY_PRIMARY}/health`, {
      signal: AbortSignal.timeout(1_500),
    })
    if (res.ok) return { base: STT_HENRY_PRIMARY, isMally: false, provisioned: true }
  } catch {
    // fall through
  }
  return { base: STT_HENRY_FALLBACK, isMally: false, provisioned: true }
}

// ─── Route ─────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/api/voice/transcribe')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const { base, isMally, provisioned } = await resolveSttBase(request)

        // Mally's STT service not yet online → signal text-only fallback mode.
        if (isMally && !provisioned) {
          return new Response(
            JSON.stringify({
              ok: false,
              voiceUnavailable: true,
              fallbackMode: 'text-only',
              error:
                'Voice routes not yet provisioned — type your prompt',
            }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          )
        }

        let audioData: ArrayBuffer
        const contentType = request.headers.get('content-type') || ''

        if (contentType.includes('multipart/form-data')) {
          // Accept FormData with field "audio"
          let formData: FormData
          try {
            formData = await request.formData()
          } catch {
            return new Response(JSON.stringify({ ok: false, error: 'Invalid form data' }), {
              status: 400, headers: { 'Content-Type': 'application/json' },
            })
          }
          const file = formData.get('audio')
          if (!(file instanceof File)) {
            return new Response(JSON.stringify({ ok: false, error: 'Missing audio field' }), {
              status: 400, headers: { 'Content-Type': 'application/json' },
            })
          }
          audioData = await file.arrayBuffer()
        } else {
          // Raw bytes
          audioData = await request.arrayBuffer()
        }

        if (audioData.byteLength === 0) {
          return new Response(JSON.stringify({ ok: false, error: 'Empty audio' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          })
        }

        let sttResp: Response
        try {
          sttResp = await fetch(`${base}/transcribe`, {
            method: 'POST',
            headers: {
              'Content-Type': contentType.includes('multipart') ? 'audio/webm' : (contentType || 'audio/webm'),
            },
            body: audioData,
            signal: AbortSignal.timeout(30_000),
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'STT request failed'
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 502, headers: { 'Content-Type': 'application/json' },
          })
        }

        if (!sttResp.ok) {
          const body = await sttResp.text().catch(() => '')
          return new Response(JSON.stringify({ ok: false, error: `STT error ${sttResp.status}: ${body}` }), {
            status: 502, headers: { 'Content-Type': 'application/json' },
          })
        }

        const result = await sttResp.json() as { text: string; backend?: string; duration_ms?: number }
        return new Response(
          JSON.stringify({
            ok: true,
            text: result.text,
            backend: result.backend,
            duration_ms: result.duration_ms,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      },
    },
  },
})
