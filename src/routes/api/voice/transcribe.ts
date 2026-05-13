/**
 * POST /api/voice/transcribe
 *
 * Forwards raw audio bytes to the local MLX Whisper STT server at :8770.
 * Falls back to :8771 (CPU faster-whisper) if :8770 health check fails.
 *
 * Request body: raw audio bytes (any content-type; multipart/form-data
 *   with field "audio" OR raw bytes in body).
 * Response: { text: string, backend: string, duration_ms: number }
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'

// Mac MLX Whisper via Tailscale (canonical big-model host per
// feedback_model_allocation_discipline.md). Override with env vars for local dev.
const STT_PRIMARY  = process.env.VOICE_STT_PRIMARY  ?? 'http://100.89.244.20:8770'
const STT_FALLBACK = process.env.VOICE_STT_FALLBACK ?? 'http://100.89.244.20:8771'

async function pickSttBase(): Promise<string> {
  try {
    const res = await fetch(`${STT_PRIMARY}/health`, { signal: AbortSignal.timeout(1_500) })
    if (res.ok) return STT_PRIMARY
  } catch {
    // fall through
  }
  return STT_FALLBACK
}

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

        const base = await pickSttBase()

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
        return new Response(JSON.stringify({ ok: true, text: result.text, backend: result.backend, duration_ms: result.duration_ms }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
